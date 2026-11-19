import type { APIRoute } from 'astro';
import { error, json } from '../../../lib/api';
import { getPendingMessage, subscriptionId } from '../../../lib/push/subscriptions';
import { isValidPushEndpoint } from '../../../lib/push/vapid';

export const prerender = false;

/**
 * Called by the service worker when a (payload-less) push arrives: returns the
 * alert text queued for this subscription. Read-only: the message expires on its
 * own, and a write here could collide with the sweep's write a moment earlier.
 */
export const POST: APIRoute = async ({ request }) => {
  let endpoint: unknown;
  try {
    endpoint = ((await request.json()) as { endpoint?: unknown }).endpoint;
  } catch {
    return error(400, 'Invalid JSON');
  }
  if (!isValidPushEndpoint(endpoint)) return error(400, 'Unsupported push endpoint');
  const message = await getPendingMessage(await subscriptionId(endpoint));
  if (!message) return error(404, 'No pending alert');
  return json(message);
};
