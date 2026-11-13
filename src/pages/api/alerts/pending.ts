import type { APIRoute } from 'astro';
import { error, json } from '../../../lib/api';
import { getSubscription, putSubscription } from '../../../lib/push/subscriptions';
import { isValidPushEndpoint } from '../../../lib/push/vapid';

export const prerender = false;

/**
 * Called by the service worker when a (payload-less) push arrives: returns the
 * alert text queued for this subscription and clears it.
 */
export const POST: APIRoute = async ({ request }) => {
  let endpoint: unknown;
  try {
    endpoint = ((await request.json()) as { endpoint?: unknown }).endpoint;
  } catch {
    return error(400, 'Invalid JSON');
  }
  if (!isValidPushEndpoint(endpoint)) return error(400, 'Unsupported push endpoint');
  const sub = await getSubscription(endpoint);
  if (!sub?.pending) return error(404, 'No pending alert');
  const message = sub.pending;
  await putSubscription({ ...sub, pending: null });
  return json(message);
};
