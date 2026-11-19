import type { APIRoute } from 'astro';
import { error, isSameOrigin, json } from '../../../lib/api';
import { baselineState, composeAlert } from '../../../lib/aqi/alert-copy';
import { defaultStandardFor } from '../../../lib/aqi/standards';
import { push } from '../../../lib/config';
import { deliver } from '../../../lib/push/sweep';
import {
  getSubscription,
  kvStore,
  putPendingMessage,
  putSubscription,
  subscriptionId,
  type AlertPrefs,
  type PendingMessage,
  type StoredSubscription,
} from '../../../lib/push/subscriptions';
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
  // Re-sync from the alerts page with nothing new: skip the (metered) KV write.
  if (sameTarget && existing.prefs.improve === prefs.improve && existing.location.name === place.name) {
    return json({ ok: true, location: existing.location, prefs });
  }

  // Baseline from the current reading so subscribers are never alerted about conditions that already exist.
  const std = prefs.standard === 'auto' ? defaultStandardFor(place.cc) : prefs.standard;
  let state = sameTarget ? existing.state : null;
  let confirmation: Omit<PendingMessage, 'url' | 'createdAt'> | null = null;
  if (!state || !existing) {
    try {
      const r = (await getLocationReport(place)).current.aqi[std];
      if (r) {
        state ??= baselineState(r.category.level, prefs.threshold, prefs);
        confirmation = composeAlert('test', place.name, std, r.aqi, r.category.level, r.dominant);
      }
    } catch {
      /* no reading right now: no baseline, generic confirmation text */
    }
  }

  const now = Date.now();
  const sub: StoredSubscription = {
    id: await subscriptionId(body.endpoint),
    endpoint: body.endpoint,
    location: { token, name: place.name },
    prefs,
    state,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.lastTestAt ? { lastTestAt: existing.lastTestAt } : {}),
  };

  // A new endpoint must prove it is real before it is stored: send the confirmation
  // notification and keep the subscription only if the push service accepts it. This
  // keeps made-up endpoints out of storage and out of every later sweep.
  let confirmationSent = false;
  if (!existing) {
    const message = confirmation ?? {
      kind: 'test' as const,
      level: 0,
      title: `Live AQI alerts are on for ${place.name}`,
      body: 'You’ll be notified when the air crosses your alert level.',
    };
    await putPendingMessage(sub.id, { ...message, url: `/city/${place.slug}`, createdAt: now });
    const outcome = await deliver(sub, 'normal');
    if (outcome === 'gone') return error(400, 'This browser subscription is no longer valid — please try again');
    if (outcome === 'failed') return error(502, 'The push service did not accept this browser — please try again');
    confirmationSent = true;
    sub.lastTestAt = now; // the confirmation counts as a test (avoids a second one straight away)
  }

  await putSubscription(sub);
  return json({ ok: true, location: sub.location, prefs, confirmationSent });
};
