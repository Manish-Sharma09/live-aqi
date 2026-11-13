/**
 * Web Push subscriptions in Workers KV (`sub:<sha256(endpoint)>`).
 * Only what is needed to evaluate alerts is stored: the push endpoint, the
 * chosen location token and display name, and the alert preferences.
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
  pending: PendingMessage | null;
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

export async function putSubscription(sub: StoredSubscription): Promise<void> {
  const kv = kvStore();
  if (!kv) throw new Error('Subscription storage (KV) is not configured');
  await kv.put(`sub:${sub.id}`, JSON.stringify(sub));
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const kv = kvStore();
  if (!kv) return;
  await kv.delete(`sub:${await subscriptionId(endpoint)}`);
}

export async function* allSubscriptions(): AsyncGenerator<StoredSubscription> {
  const kv = kvStore();
  if (!kv) return;
  let cursor: string | undefined;
  do {
    const page: KVNamespaceListResult<unknown, string> = await kv.list({ prefix: 'sub:', ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const sub = await kv.get<StoredSubscription>(key.name, 'json');
      if (sub) yield sub;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}
