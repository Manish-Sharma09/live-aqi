/**
 * Cron-driven alert sweep: for every push subscriber, evaluate the latest
 * reading at their chosen location and send a push only when the shared
 * de-duplication rules (`evaluateAlert`) say the situation actually changed.
 */
import { composeAlert, evaluateAlert } from '../aqi/alert-copy';
import { defaultStandardFor } from '../aqi/standards';
import { push } from '../config';
import { getLocationReport, resolveLocationToken, type LocationReport } from '../services/reports';
import type { Place } from '../geo/places';
import { allSubscriptions, deleteSubscription, kvStore, putSubscription, type StoredSubscription } from './subscriptions';
import { sendPush } from './vapid';

export interface SweepResult {
  checked: number;
  sent: number;
  removed: number;
  errors: number;
}

export async function deliver(sub: StoredSubscription, urgency: 'normal' | 'high'): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const res = await sendPush(sub.endpoint, { urgency, topic: `aqi${sub.id.slice(0, 20)}`, ttlSeconds: 6 * 60 * 60 });
    if (res.gone) {
      await deleteSubscription(sub.endpoint);
      return 'gone';
    }
    if (!res.ok) console.warn(`[push] ${res.status} from push service for ${sub.id}`);
    return res.ok ? 'sent' : 'failed';
  } catch (err) {
    console.error('[push] send failed', err);
    return 'failed';
  }
}

export async function runAlertSweep(): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, sent: 0, removed: 0, errors: 0 };
  if (!push.enabled || !kvStore()) return result;

  const places = new Map<string, Promise<{ place: Place; report: LocationReport } | null>>();
  const load = (token: string) => {
    let p = places.get(token);
    if (!p) {
      p = (async () => {
        const place = await resolveLocationToken(token);
        if (!place) return null;
        return { place, report: await getLocationReport(place) };
      })().catch((err) => {
        console.error('[sweep] report failed for', token, err);
        return null;
      });
      places.set(token, p);
    }
    return p;
  };

  for await (const sub of allSubscriptions()) {
    result.checked++;
    const data = await load(sub.location.token);
    if (!data) {
      result.errors++;
      continue;
    }
    const std = sub.prefs.standard === 'auto' ? defaultStandardFor(data.place.cc) : sub.prefs.standard;
    const reading = data.report.current.aqi[std];
    if (!reading) continue;

    const { kind, next } = evaluateAlert(sub.state, reading.category.level, data.report.current.time, sub.prefs.threshold, sub.prefs);
    const stateChanged = JSON.stringify(next) !== JSON.stringify(sub.state);
    if (!kind && !stateChanged) continue; // nothing new — no KV write

    const updated: StoredSubscription = { ...sub, state: next, updatedAt: Date.now() };
    if (kind) {
      const msg = composeAlert(kind, sub.location.name, std, reading.aqi, reading.category.level);
      updated.pending = { ...msg, url: `/city/${data.place.slug}`, createdAt: Date.now() };
    }
    await putSubscription(updated);
    if (kind) {
      const outcome = await deliver(updated, kind === 'severe' ? 'high' : 'normal');
      if (outcome === 'sent') result.sent++;
      else if (outcome === 'gone') result.removed++;
      else result.errors++;
    }
  }
  console.log('[sweep]', JSON.stringify(result));
  return result;
}
