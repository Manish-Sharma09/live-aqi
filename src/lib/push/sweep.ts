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
import {
  allSubscriptions,
  deleteSubscription,
  kvStore,
  MESSAGE_TTL_SECONDS,
  putPendingMessage,
  putSubscription,
  type StoredSubscription,
} from './subscriptions';
import { sendPush } from './vapid';

export interface SweepResult {
  checked: number;
  sent: number;
  removed: number;
  errors: number;
}

export async function deliver(sub: StoredSubscription, urgency: 'normal' | 'high'): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const res = await sendPush(sub.endpoint, { urgency, topic: `aqi${sub.id.slice(0, 20)}`, ttlSeconds: MESSAGE_TTL_SECONDS });
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

/** A failed alert is retried on later sweeps, up to this many attempts in total. */
const MAX_DELIVERY_ATTEMPTS = 3;
/** Subscribers processed at the same time. */
const SWEEP_CONCURRENCY = 6;

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

  const processOne = async (sub: StoredSubscription) => {
    result.checked++;
    // One subscriber's failure (KV quota, a bad record) must not end the sweep for everyone else.
    try {
      const data = await load(sub.location.token);
      if (!data) {
        result.errors++;
        return;
      }
      const std = sub.prefs.standard === 'auto' ? defaultStandardFor(data.place.cc) : sub.prefs.standard;
      const reading = data.report.current.aqi[std];
      if (!reading) return;

      const { kind, next } = evaluateAlert(sub.state, reading.category.level, data.report.current.time, sub.prefs.threshold, sub.prefs);
      if (!kind) {
        // No notification; save the state only if it changed (KV writes are metered).
        if (JSON.stringify(next) !== JSON.stringify(sub.state)) {
          await putSubscription({ ...sub, state: next, updatedAt: Date.now() });
        }
        return;
      }

      const msg = composeAlert(kind, sub.location.name, std, reading.aqi, reading.category.level, reading.dominant);
      await putPendingMessage(sub.id, { ...msg, url: `/city/${data.place.slug}`, createdAt: Date.now() });
      const outcome = await deliver(sub, kind === 'severe' ? 'high' : 'normal');
      if (outcome === 'gone') {
        result.removed++;
        return;
      }
      if (outcome === 'sent') {
        result.sent++;
        await putSubscription({ ...sub, state: next, failedAttempts: 0, updatedAt: Date.now() });
        return;
      }
      // Not delivered: keep the old state so the next sweep tries again, unless this
      // alert has already failed several times (e.g. a broken endpoint).
      result.errors++;
      const attempts = (sub.failedAttempts ?? 0) + 1;
      await putSubscription(
        attempts >= MAX_DELIVERY_ATTEMPTS
          ? { ...sub, state: next, failedAttempts: 0, updatedAt: Date.now() }
          : { ...sub, failedAttempts: attempts, updatedAt: Date.now() },
      );
    } catch (err) {
      result.errors++;
      console.error('[sweep] subscriber', sub.id, 'failed', err);
    }
  };

  // Small parallel batches: much faster than one at a time, while staying well under
  // the runtime's limit on simultaneous connections.
  let batch: StoredSubscription[] = [];
  for await (const sub of allSubscriptions()) {
    batch.push(sub);
    if (batch.length >= SWEEP_CONCURRENCY) {
      await Promise.all(batch.map(processOne));
      batch = [];
    }
  }
  await Promise.all(batch.map(processOne));
  console.log('[sweep]', JSON.stringify(result));
  return result;
}
