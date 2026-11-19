// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://live-aqi.com',
  trailingSlash: 'never',

  adapter: cloudflare({
    // The site does not transform raster images at runtime, so no Images binding is needed.
    imageService: 'passthrough',
  }),

  // Astro sessions are not used; skip provisioning a session KV namespace.
  session: false,

  // Route caching: pages opt in with `Astro.cache.set(...)`; Cloudflare's edge honours it.
  cache: { provider: cacheCloudflare() },

  env: {
    validateSecrets: false,
    schema: {
      // Optional: World Air Quality Index token — enables ground-station layers.
      WAQI_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Optional: Open-Meteo commercial API key (switches to the customer-* endpoints).
      OPEN_METEO_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Web Push (VAPID). When unset, background push alerts are reported as unavailable.
      // All three are read at runtime (`access: 'secret'`): a `public` server variable is
      // inlined at build time, which would bake the local .dev.vars key into the bundle and
      // ignore the production `wrangler secret` / `vars` values.
      VAPID_PUBLIC_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_PRIVATE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_SUBJECT: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Optional: Google Analytics 4 measurement ID ("G-XXXXXXXXXX"), set in wrangler.jsonc `vars`.
      // Read at runtime like VAPID_SUBJECT; when unset, no analytics script is loaded.
      GA_MEASUREMENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },

  // Self-hosted variable font (OFL): Plus Jakarta Sans, weights 200–800.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Plus Jakarta Sans',
      cssVariable: '--font-jakarta',
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      options: {
        variants: [
          { src: ['./src/assets/fonts/plus-jakarta-sans-latin-wght-normal.woff2'], weight: '200 800', style: 'normal', unicodeRange: ['U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC', 'U+0304', 'U+0308', 'U+0329', 'U+2000-206F', 'U+20AC', 'U+2122', 'U+2191', 'U+2193', 'U+2212', 'U+2215', 'U+FEFF', 'U+FFFD'] },
          { src: ['./src/assets/fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2'], weight: '200 800', style: 'normal', unicodeRange: ['U+0100-02BA', 'U+02BD-02C5', 'U+02C7-02CC', 'U+02CE-02D7', 'U+02DD-02FF', 'U+1D00-1DBF', 'U+1E00-1E9F', 'U+1EF2-1EFF', 'U+2020', 'U+20A0-20AB', 'U+20AD-20C0', 'U+2113', 'U+2C60-2C7F', 'U+A720-A7FF'] },
        ],
      },
    },
  ],

  vite: {
    plugins: [tailwindcss()],
    // Emit JSON imports (the ~1.5 MB city list) as JSON.parse("…") rather than a JS
    // object literal: much faster to parse on every Worker cold start.
    json: { stringify: true },
  },
});
