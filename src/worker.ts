/**
 * Cloudflare Worker entry: Astro handles every HTTP request; the cron trigger
 * (see wrangler.jsonc) runs the Web Push alert sweep.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { runAlertSweep } from './lib/push/sweep';

export default {
  fetch: handle,
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(runAlertSweep());
  },
} satisfies ExportedHandler<Env>;
