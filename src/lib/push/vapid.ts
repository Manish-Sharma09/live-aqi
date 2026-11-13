/**
 * Web Push sender (RFC 8030 + VAPID, RFC 8292) using only WebCrypto, so it
 * runs on Cloudflare Workers without Node APIs.
 *
 * Messages are sent without a payload ("tickle" pushes). The service worker
 * then fetches the pending alert text from /api/alerts/pending — this avoids
 * payload encryption entirely while keeping alert content server-controlled.
 */
import { push } from '../config';

const enc = new TextEncoder();

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

let keyPromise: Promise<CryptoKey> | null = null;

function signingKey(): Promise<CryptoKey> {
  if (!push.publicKey || !push.privateKey) return Promise.reject(new Error('VAPID keys are not configured'));
  keyPromise ??= (async () => {
    const pub = b64urlDecode(push.publicKey!);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 point (base64url)');
    const jwk: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: push.privateKey!,
      ext: false,
    };
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  })();
  return keyPromise;
}

async function vapidHeader(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp, sub: push.subject })));
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(), enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${push.publicKey}`;
}

export interface PushResult {
  ok: boolean;
  /** The subscription no longer exists and should be deleted. */
  gone: boolean;
  status: number;
}

export async function sendPush(endpoint: string, opts: { urgency: 'normal' | 'high'; topic: string; ttlSeconds: number }): Promise<PushResult> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(endpoint),
      TTL: String(opts.ttlSeconds),
      Urgency: opts.urgency,
      // Topic lets the push service replace an undelivered older alert for the same subscription.
      Topic: opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
      'Content-Length': '0',
    },
    signal: AbortSignal.timeout(10000),
  });
  return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
}

/** Push services browsers actually use — anything else is rejected (no arbitrary outbound POSTs). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

export function isValidPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}
