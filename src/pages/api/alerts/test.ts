import type { APIRoute } from 'astro';
import { error, isSameOrigin, json } from '../../../lib/api';
import { composeAlert } from '../../../lib/aqi/alert-copy';
import { defaultStandardFor } from '../../../lib/aqi/standards';
import { push } from '../../../lib/config';
import { deliver } from '../../../lib/push/sweep';
import { getSubscription, putSubscription } from '../../../lib/push/subscriptions';
import { isValidPushEndpoint } from '../../../lib/push/vapid';
import { getLocationReport, resolveLocationToken } from '../../../lib/services/reports';

export const prerender = false;

/** Send a real test push through the same pipeline the cron sweep uses (max once per minute). */
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return error(403, 'Forbidden');
  if (!push.enabled) return error(503, 'Background notifications are not configured on this server');
  let endpoint: unknown;
  try {
    endpoint = ((await request.json()) as { endpoint?: unknown }).endpoint;
  } catch {
    return error(400, 'Invalid JSON');
  }
  if (!isValidPushEndpoint(endpoint)) return error(400, 'Unsupported push endpoint');
  const sub = await getSubscription(endpoint);
  if (!sub) return error(404, 'Subscription not found — enable notifications first');
  if (sub.lastTestAt && Date.now() - sub.lastTestAt < 60_000) return error(429, 'Please wait a minute between test notifications');

  const place = await resolveLocationToken(sub.location.token);
  if (!place) return error(400, 'Unknown location');
  let report;
  try {
    report = await getLocationReport(place);
  } catch {
    return error(502, 'Air-quality data is unavailable right now');
  }
  const std = sub.prefs.standard === 'auto' ? defaultStandardFor(place.cc) : sub.prefs.standard;
  const r = report.current.aqi[std];
  if (!r) return error(502, 'No current reading for this location');

  const msg = composeAlert('test', sub.location.name, std, r.aqi, r.category.level);
  const updated = { ...sub, pending: { ...msg, url: `/city/${place.slug}`, createdAt: Date.now() }, lastTestAt: Date.now() };
  await putSubscription(updated);
  const outcome = await deliver(updated, 'normal');
  if (outcome === 'gone') return error(410, 'This browser subscription has expired — please enable notifications again');
  if (outcome === 'failed') return error(502, 'The push service did not accept the notification');
  return json({ ok: true });
};
