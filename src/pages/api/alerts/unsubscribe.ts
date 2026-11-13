import type { APIRoute } from 'astro';
import { error, isSameOrigin, json } from '../../../lib/api';
import { deleteSubscription } from '../../../lib/push/subscriptions';
import { isValidPushEndpoint } from '../../../lib/push/vapid';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return error(403, 'Forbidden');
  let endpoint: unknown;
  try {
    endpoint = ((await request.json()) as { endpoint?: unknown }).endpoint;
  } catch {
    return error(400, 'Invalid JSON');
  }
  if (!isValidPushEndpoint(endpoint)) return error(400, 'Unsupported push endpoint');
  await deleteSubscription(endpoint);
  return json({ ok: true });
};
