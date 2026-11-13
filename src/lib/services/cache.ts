/**
 * Layered data cache for upstream API results.
 *
 *   1. In-isolate memory      — fastest, per Worker instance.
 *   2. Cloudflare Cache API   — shared by a data centre (no-op on workers.dev).
 *   3. Workers KV (opt-in)    — global; used for snapshots that are costly to rebuild.
 *
 * Entries are fresh for `fresh` seconds, then served while a background refresh
 * runs for another `stale` seconds. If a refresh fails, the last known value
 * (up to 24 h old) is returned and flagged `stale: true` so the UI can say so.
 */
import { env, waitUntil } from 'cloudflare:workers';

interface Entry<T> {
  v: T;
  at: number;
}

export interface Cached<T> {
  value: T;
  fetchedAt: number;
  /** True when a refresh failed and an older value is being served. */
  stale: boolean;
}

export interface CacheOptions {
  fresh: number;
  stale: number;
  /** Also persist to Workers KV (use sparingly — KV writes are metered). */
  kv?: boolean;
}

const LAST_KNOWN_SECONDS = 24 * 60 * 60;
const MEMORY_LIMIT = 400;
const memory = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<Entry<unknown>>>();

function memGet<T>(key: string): Entry<T> | undefined {
  const e = memory.get(key) as Entry<T> | undefined;
  if (e) {
    memory.delete(key);
    memory.set(key, e); // LRU touch
  }
  return e;
}

function memSet(key: string, e: Entry<unknown>) {
  memory.set(key, e);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
}

/** Workers' per-data-centre cache (`caches.default`). */
const edgeCache = () => (caches as unknown as { default: Cache }).default;

const edgeKey = (key: string) => new Request(`https://cache.live-aqi.internal/v1/${encodeURIComponent(key)}`);

async function edgeGet<T>(key: string): Promise<Entry<T> | undefined> {
  try {
    const res = await edgeCache().match(edgeKey(key));
    return res ? ((await res.json()) as Entry<T>) : undefined;
  } catch {
    return undefined;
  }
}

async function edgePut(key: string, e: Entry<unknown>) {
  try {
    await edgeCache().put(
      edgeKey(key),
      new Response(JSON.stringify(e), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${LAST_KNOWN_SECONDS}` },
      }),
    );
  } catch {
    /* Cache API unavailable (e.g. workers.dev) — ignore */
  }
}

function kv(): KVNamespace | undefined {
  return (env as unknown as { LIVE_AQI_KV?: KVNamespace }).LIVE_AQI_KV;
}

async function kvGet<T>(key: string): Promise<Entry<T> | undefined> {
  try {
    return (await kv()?.get<Entry<T>>(`cache:${key}`, 'json')) ?? undefined;
  } catch {
    return undefined;
  }
}

async function kvPut(key: string, e: Entry<unknown>) {
  try {
    await kv()?.put(`cache:${key}`, JSON.stringify(e), { expirationTtl: LAST_KNOWN_SECONDS });
  } catch {
    /* KV unavailable or over quota — memory/edge layers still work */
  }
}

/** Schedule work after the response is sent; falls back to fire-and-forget. */
export function background(p: Promise<unknown>) {
  const guarded = p.catch((err) => console.error('[background]', err));
  try {
    waitUntil(guarded);
  } catch {
    /* outside a request context */
  }
}

export async function cached<T>(key: string, opts: CacheOptions, loader: () => Promise<T>): Promise<Cached<T>> {
  const now = Date.now();
  let entry: Entry<T> | undefined = memGet<T>(key);
  if (!entry) {
    entry = await edgeGet<T>(key);
    if (!entry && opts.kv) entry = await kvGet<T>(key);
    if (entry) memSet(key, entry);
  }

  const refresh = (): Promise<Entry<T>> => {
    const pending = inflight.get(key) as Promise<Entry<T>> | undefined;
    if (pending) return pending;
    const p = (async () => {
      const value = await loader();
      const e: Entry<T> = { v: value, at: Date.now() };
      memSet(key, e);
      await Promise.all([edgePut(key, e), opts.kv ? kvPut(key, e) : Promise.resolve()]);
      return e;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  if (entry) {
    const age = (now - entry.at) / 1000;
    if (age < opts.fresh) return { value: entry.v, fetchedAt: entry.at, stale: false };
    if (age < opts.fresh + opts.stale) {
      background(refresh());
      return { value: entry.v, fetchedAt: entry.at, stale: false };
    }
  }

  try {
    const fresh = await refresh();
    return { value: fresh.v, fetchedAt: fresh.at, stale: false };
  } catch (err) {
    if (entry && (now - entry.at) / 1000 < LAST_KNOWN_SECONDS) {
      console.warn(`[cache] serving last known value for ${key}:`, err);
      return { value: entry.v, fetchedAt: entry.at, stale: true };
    }
    throw err;
  }
}
