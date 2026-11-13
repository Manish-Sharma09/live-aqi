import type { APIRoute } from 'astro';
import { error, isSameOrigin, json } from '../../../lib/api';
import { baselineState } from '../../../lib/aqi/alert-copy';
import { defaultStandardFor } from '../../../lib/aqi/standards';
import { push } from '../../../lib/config';
import { getSubscription, kvStore, putSubscription, subscriptionId, type AlertPrefs, type StoredSubscription } from '../../../lib/push/subscriptions';
import { isValidPushEndpoint } from '../../../lib/push/vapid';
import { getLocationReport, resolveLocationToken } from '../../../lib/services/reports';

export const prerender = false;

interface Body {
  endpoint?: unknown;
  location?: { token?: unknown };
  prefs?: Partial<Record<keyof AlertPrefs, unknown>>;
}

/** Create or update a Web Push subscription with its location and alert preferences. */
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return error(403, 'Forbidden');
  if (!push.enabled || !kvStore()) return error(503, 'Background notifications are not configured on this server');

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return error(400, 'Invalid JSON');
  }
  if (!isValidPushEndpoint(body.endpoint)) return error(400, 'Unsupported push endpoint');
  const token = typeof body.location?.token === 'string' ? body.location.token : '';
  const place = await resolveLocationToken(token).catch(() => null);
  if (!place) return error(400, 'Unknown location');

  const p = body.prefs ?? {};
  const prefs: AlertPrefs = {
    standard: p.standard === 'us' || p.standard === 'in' ? p.standard : 'auto',
    threshold: typeof p.threshold === 'number' && p.threshold >= 1 && p.threshold <= 6 ? Math.round(p.threshold) : 3,
    severe: p.severe !== false,
    improve: p.improve !== false,
  };

  const existing = await getSubscription(body.endpoint);
  const sameTarget =
    existing &&
    existing.location.token === token &&
    existing.prefs.standard === prefs.standard &&
    existing.prefs.threshold === prefs.threshold &&
    existing.prefs.severe === prefs.severe;

  // Baseline from the current reading so subscribers are never alerted about conditions that already exist.
  let state = sameTarget ? existing.state : null;
  if (!state) {
    try {
      const report = await getLocationReport(place);
      const std = prefs.standard === 'auto' ? defaultStandardFor(place.cc) : prefs.standard;
      const r = report.current.aqi[std];
      if (r) state = baselineState(r.category.level, prefs.threshold, prefs);
    } catch {
      state = null;
    }
  }

  const now = Date.now();
  const sub: StoredSubscription = {
    id: await subscriptionId(body.endpoint),
    endpoint: body.endpoint,
    location: { token, name: place.name },
    prefs,
    state,
    pending: existing?.pending ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.lastTestAt ? { lastTestAt: existing.lastTestAt } : {}),
  };
  await putSubscription(sub);
  return json({ ok: true, location: sub.location, prefs });
};
