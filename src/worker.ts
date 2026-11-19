/**
 * Cloudflare Worker entry: Astro handles every HTTP request; the cron trigger
 * (see wrangler.jsonc) pre-builds the world snapshot and runs the Web Push alert sweep.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { runAlertSweep } from './lib/push/sweep';
import { prewarmWorldSnapshot } from './lib/services/reports';

/**
 * Per-IP limit on `/api/*`: each uncached API call can reach the upstream data
 * providers, whose free quotas are shared by every visitor. The binding is
 * declared in wrangler.jsonc; without it, requests pass through unchanged.
 */
async function rateLimited(request: Request, env: Env): Promise<Response | null> {
  if (!new URL(request.url).pathname.startsWith('/api/')) return null;
  const limiter = (env as Env & { API_RATE_LIMITER?: RateLimit }).API_RATE_LIMITER;
  const ip = request.headers.get('cf-connecting-ip');
  if (!limiter || !ip) return null;
  try {
    const { success } = await limiter.limit({ key: ip });
    if (success) return null;
  } catch {
    return null; // never block traffic because the limiter itself failed
  }
  return new Response(JSON.stringify({ error: 'Too many requests — please slow down' }), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' },
  });
}

/**
 * Keep the *.workers.dev copy of the site (and preview URLs) out of search results:
 * only live-aqi.com should be indexed. Pages already carry a canonical link to
 * live-aqi.com; this header makes it explicit. Turn the workers.dev route off in
 * Cloudflare once the custom domain is live (see README → Deploy).
 */
function noindexOnWorkersDev(request: Request, response: Response): Response {
  if (!new URL(request.url).hostname.endsWith('.workers.dev')) return response;
  const res = new Response(response.body, response);
  res.headers.set('x-robots-tag', 'noindex, nofollow');
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const response = (await rateLimited(request, env)) ?? (await handle(request, env, ctx));
    return noindexOnWorkersDev(request, response);
  },
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(
      prewarmWorldSnapshot().then(
        (rebuilt) => rebuilt && console.log('[cron] world snapshot rebuilt'),
        (err) => console.error('[cron] world snapshot failed', err),
      ),
    );
    ctx.waitUntil(runAlertSweep());
  },
} satisfies ExportedHandler<Env>;
