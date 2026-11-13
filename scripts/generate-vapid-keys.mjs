#!/usr/bin/env node
/**
 * Generates a VAPID key pair for Web Push.
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * Local development: paste the output into `.dev.vars`.
 * Production:        npx wrangler secret put VAPID_PRIVATE_KEY
 *                    npx wrangler secret put VAPID_PUBLIC_KEY
 * Keep the same pair once users have subscribed — rotating it invalidates subscriptions.
 */
import { webcrypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const rawPublic = await webcrypto.subtle.exportKey('raw', publicKey); // 65-byte uncompressed point
const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);

console.log(`VAPID_PUBLIC_KEY=${b64url(rawPublic)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
