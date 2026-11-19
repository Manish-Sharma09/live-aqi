import type { APIRoute } from 'astro';
import { error, isSameOrigin, json } from '../../../lib/api';
import { deleteSubscription, getSubscription, putSubscription, subscriptionId } from '../../../lib/push/subscriptions';
import { isValidPushEndpoint } from '../../../lib/push/vapid';

export const prerender = false;

/**
 * Called by the service worker on `pushsubscriptionchange`: the browser replaced
 * its push subscription, so move the saved location and preferences to the new
 * endpoint. Knowing the old endpoint (a secret URL) is the proof of ownership.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return error(403, 'Forbidden');
  let body: { oldEndpoint?: unknown; endpoint?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'Invalid JSON');
  }
  const { oldEndpoint, endpoint } = body;
  if (!isValidPushEndpoint(oldEndpoint) || !isValidPushEndpoint(endpoint)) return error(400, 'Unsupported push endpoint');
  if (oldEndpoint === endpoint) return json({ ok: true });

  const old = await getSubscription(oldEndpoint);
  if (!old) return error(404, 'Subscription not found');
  await putSubscription({ ...old, id: await subscriptionId(endpoint), endpoint, failedAttempts: 0, updatedAt: Date.now() });
  await deleteSubscription(oldEndpoint);
  return json({ ok: true });
};
