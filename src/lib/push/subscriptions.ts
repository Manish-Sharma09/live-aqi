/**
 * Web Push subscriptions in Workers KV (`sub:<sha256(endpoint)>`).
 * Only what is needed to evaluate alerts is stored: the push endpoint, the
 * chosen location token and display name, and the alert preferences.
 *
 * The text of the next notification lives under its own key (`msg:<id>`): the
 * service worker reads it when the payload-less push arrives. Keeping it apart
 * means the sweep can queue the text, push, and only then save the new alert
 * state, without two writes to one key inside KV's one-write-per-second limit.
 */
import { env } from 'cloudflare:workers';
import type { AlertKind, AlertState } from '../aqi/alert-copy';

export interface AlertPrefs {
  standard: 'auto' | 'us' | 'in';
  threshold: number;
  severe: boolean;
  improve: boolean;
}

export interface PendingMessage {
  kind: AlertKind;
  title: string;
  body: string;
  url: string;
  level: number;
  createdAt: number;
}

export interface StoredSubscription {
  id: string;
  endpoint: string;
  location: { token: string; name: string };
  prefs: AlertPrefs;
  state: AlertState | null;
  /** Consecutive failed deliveries of the current alert (see the sweep). */
  failedAttempts?: number;
  createdAt: number;
  updatedAt: number;
  lastTestAt?: number;
}

export function kvStore(): KVNamespace | null {
  return (env as unknown as { LIVE_AQI_KV?: KVNamespace }).LIVE_AQI_KV ?? null;
}

export async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].slice(0, 20).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getSubscription(endpoint: string): Promise<StoredSubscription | null> {
  const kv = kvStore();
  if (!kv) return null;
  return kv.get<StoredSubscription>(`sub:${await subscriptionId(endpoint)}`, 'json');
}

/** KV list metadata is capped at 1024 bytes of JSON; leave a little headroom. */
const METADATA_LIMIT = 1000;

export async function putSubscription(sub: StoredSubscription): Promise<void> {
  const kv = kvStore();
  if (!kv) throw new Error('Subscription storage (KV) is not configured');
  const json = JSON.stringify(sub);
  // Mirror the record into the key's metadata (when it fits) so the sweep can read
  // every subscriber from `list()` alone instead of one `get` per subscriber.
  const fits = new TextEncoder().encode(json).length <= METADATA_LIMIT;
  await kv.put(`sub:${sub.id}`, json, fits ? { metadata: sub } : undefined);
}

function isSubscription(v: unknown): v is StoredSubscription {
  const s = v as Partial<StoredSubscription> | null;
  return Boolean(s && typeof s.id === 'string' && typeof s.endpoint === 'string' && s.location && s.prefs);
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const kv = kvStore();
  if (!kv) return;
  const id = await subscriptionId(endpoint);
  await Promise.all([kv.delete(`sub:${id}`), kv.delete(`msg:${id}`)]);
}

/** Kept as long as the push itself may wait for delivery (see `deliver`). */
export const MESSAGE_TTL_SECONDS = 6 * 60 * 60;

export async function putPendingMessage(id: string, message: PendingMessage): Promise<void> {
  const kv = kvStore();
  if (!kv) throw new Error('Subscription storage (KV) is not configured');
  await kv.put(`msg:${id}`, JSON.stringify(message), { expirationTtl: MESSAGE_TTL_SECONDS });
}

export async function getPendingMessage(id: string): Promise<PendingMessage | null> {
  const kv = kvStore();
  if (!kv) return null;
  return kv.get<PendingMessage>(`msg:${id}`, 'json');
}

export async function* allSubscriptions(): AsyncGenerator<StoredSubscription> {
  const kv = kvStore();
  if (!kv) return;
  let cursor: string | undefined;
  do {
    const page: KVNamespaceListResult<unknown, string> = await kv.list({ prefix: 'sub:', ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      // Older records (or ones too large for metadata) still need a read.
      const sub = isSubscription(key.metadata) ? key.metadata : await kv.get<StoredSubscription>(key.name, 'json');
      if (sub) yield sub;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}
