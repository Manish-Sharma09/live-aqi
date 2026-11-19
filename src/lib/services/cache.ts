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
/** A refresh still pending after this long is treated as lost (e.g. its request was cancelled). */
const INFLIGHT_MAX_MS = 30_000;
/** After a failed refresh, skip the upstream for this long so an outage doesn't stall every request. */
const FAILURE_BACKOFF_MS = 60_000;
const memory = new Map<string, Entry<unknown>>();
const inflight = new Map<string, { p: Promise<Entry<unknown>>; started: number }>();
const failures = new Map<string, { at: number; err: unknown }>();

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

/** Newest entry in the shared layers (Cache API, then KV when enabled). */
async function sharedGet<T>(key: string, opts: CacheOptions): Promise<Entry<T> | undefined> {
  const [edge, stored] = await Promise.all([edgeGet<T>(key), opts.kv ? kvGet<T>(key) : Promise.resolve(undefined)]);
  if (stored && (!edge || stored.at > edge.at)) {
    background(edgePut(key, stored)); // warm this data centre's cache
    return stored;
  }
  return edge;
}

/** Write an entry to every layer this key uses. */
async function storeEntry(key: string, opts: CacheOptions, e: Entry<unknown>) {
  memSet(key, e);
  await Promise.all([edgePut(key, e), opts.kv ? kvPut(key, e) : Promise.resolve()]);
}

/**
 * Rebuild an entry ahead of demand (from the cron) when the newest shared copy is
 * older than `refreshAfter` seconds, so visitors find it fresh instead of triggering
 * the rebuild themselves. Returns true when it rebuilt.
 */
export async function prewarm<T>(key: string, opts: CacheOptions, loader: () => Promise<T>, refreshAfter: number): Promise<boolean> {
  const current = (await sharedGet<T>(key, opts)) ?? memGet<T>(key);
  if (current && (Date.now() - current.at) / 1000 < refreshAfter) return false;
  await storeEntry(key, opts, { v: await loader(), at: Date.now() });
  return true;
}

/**
 * Resolve to null if `p` hasn't settled within `ms` (it keeps running, so a cache
 * rebuild still completes for the next request). For optional page sections that
 * shouldn't hold up the page while a slow snapshot is rebuilt.
 */
export function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
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
  let sharedChecked = false;
  if (!entry) {
    entry = await sharedGet<T>(key, opts);
    sharedChecked = true;
    if (entry) memSet(key, entry);
  }

  const refresh = (): Promise<Entry<T>> => {
    const pending = inflight.get(key);
    if (pending && Date.now() - pending.started < INFLIGHT_MAX_MS) return pending.p as Promise<Entry<T>>;
    const failed = failures.get(key);
    if (failed && Date.now() - failed.at < FAILURE_BACKOFF_MS) return Promise.reject(failed.err);

    const p = (async () => {
      // Another isolate may already have refreshed the shared layers: use that instead
      // of calling the upstream API again.
      const shared = sharedChecked ? undefined : await sharedGet<T>(key, opts);
      if (shared && (!entry || shared.at > entry.at) && (Date.now() - shared.at) / 1000 < opts.fresh) {
        memSet(key, shared);
        return shared;
      }
      let value: T;
      try {
        value = await loader();
      } catch (err) {
        failures.set(key, { at: Date.now(), err });
        throw err;
      }
      failures.delete(key);
      const e: Entry<T> = { v: value, at: Date.now() };
      await storeEntry(key, opts, e);
      return e;
    })();
    const tracked: Promise<Entry<T>> = p.finally(() => {
      if (inflight.get(key)?.p === tracked) inflight.delete(key);
    });
    inflight.set(key, { p: tracked, started: Date.now() });
    // Keep the shared refresh alive even if the request that started it goes away;
    // other requests in this isolate may be waiting on it.
    background(tracked);
    return tracked;
  };

  if (entry) {
    const age = (now - entry.at) / 1000;
    if (age < opts.fresh) return { value: entry.v, fetchedAt: entry.at, stale: false };
    if (age < opts.fresh + opts.stale) {
      refresh().catch(() => {}); // already kept alive and logged by refresh()
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
