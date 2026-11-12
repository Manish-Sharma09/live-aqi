# Live AQI — live-aqi.com

Real-time air quality for every city in the world: AQI in both the **US EPA** and **India NAQI (CPCB)**
standards, pollutant breakdown, 7-day history and 48-hour forecast, health guidance, a global map,
rankings, country/region dashboards, and pollution alerts (in-page and background Web Push).

Built with **Astro 7** (on-demand rendering), **Tailwind CSS v4**, and deployed to **Cloudflare Workers**.
The visual system follows `../DESIGN.md` (black “stage” → white reading surface, colour only in the data).

## Quick start

```sh
npm install
npm run vapid-keys > .dev.vars   # local Web Push keys (git-ignored); optionally add WAQI_TOKEN=...
npm run dev                      # http://localhost:4321 — runs on workerd, like production
npm run check                    # TypeScript + Astro diagnostics
npm run build && npm run preview # production bundle on workerd
```

Trigger the alert cron locally: `curl "http://localhost:4321/cdn-cgi/handler/scheduled"`.

## Configuration

All configuration is validated through `astro:env` (see `astro.config.mjs`, read in `src/lib/config.ts`).
Secrets never reach the browser.

| Variable | Kind | Required | Purpose |
|---|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | secret | for push | Web Push (VAPID). Without them, background notifications are reported as unavailable; in-page alerts still work. |
| `VAPID_SUBJECT` | var | — | Contact for push services (`mailto:` or URL). Default `mailto:alerts@live-aqi.com`. |
| `OPEN_METEO_API_KEY` | secret | **for commercial use** | Switches to Open-Meteo’s `customer-*` endpoints. The free tier is non-commercial and limited to 10,000 calls/day. |
| `WAQI_TOKEN` | secret | optional | Enables ground-station data (map layer, “nearby stations”, station search). Get one at aqicn.org/data-platform/token. |

Bindings (in `wrangler.jsonc`): `LIVE_AQI_KV` (KV: snapshot cache + push subscriptions; auto-provisioned on first
deploy) and a cron trigger every 30 minutes for the alert sweep.

## Deploy (Cloudflare Workers)

```sh
npx wrangler login
npm run vapid-keys                       # generate the production pair ONCE and keep it
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put OPEN_METEO_API_KEY   # recommended for production / commercial use
npx wrangler secret put WAQI_TOKEN           # optional
npm run deploy
```

Then attach the `live-aqi.com` custom domain to the Worker. Edge page caching (`Astro.cache.set`) and the
per-data-centre Cache API only take effect on a custom domain, not on `*.workers.dev`.

The **Workers Paid** plan is recommended: building the ~300-city world snapshot takes more CPU than the free plan’s
10 ms limit, and KV writes on the free plan are capped at 1,000/day.

## Data & standards

- **Air quality:** Open-Meteo, serving CAMS forecasts (≈11 km Europe, ≈45 km global). Hourly concentrations of
  PM2.5, PM10, O₃, NO₂, SO₂ and CO. Live AQI computes every index itself (`src/lib/aqi/`), so the two standards
  are never mixed. Values are **modelled** and labelled as such.
- **US AQI:** EPA breakpoints incl. the 2024 PM2.5 revision; NowCast for PM; EPA truncation rules; capped at “500+”.
- **India NAQI:** CPCB breakpoints; 24-h means (≥16 h) and max 8-h means for O₃/CO; ≥3 pollutants incl. PM.
- **Weather:** Open-Meteo forecast API. **Places:** GeoNames (CC BY 4.0). **Map tiles:** OpenFreeMap / OpenStreetMap.
- Nothing is ever fabricated: provider failures show an error, or the last real data with its age.

See `/methodology` on the site for the full write-up.

## Architecture

```
src/
  lib/aqi/          standards, breakpoints, AQI computation, health guidance, alert rules (pure TS)
  lib/services/     provider clients (open-meteo, waqi), layered cache, domain reports, search
  lib/push/         VAPID Web Push sender, KV subscriptions, cron sweep
  lib/chart/        SVG chart renderer shared by server (first paint) and browser
  lib/geo/          GeoNames-derived city/country index, slugs, nearest-city, local search
  components/       Astro components (no UI framework); client behaviour in <script> modules
  pages/            routes: /, /city/[slug], /country/[country], /map, /world, /rankings, /alerts, …
  pages/api/        JSON endpoints: search, locate, summary, map data, alerts
  worker.ts         Worker entry: Astro handler + scheduled() alert sweep
public/sw.js        service worker for background notifications
scripts/            data/asset generators (geodata, VAPID keys, brand assets)
```

Caching layers: in-isolate memory → Cloudflare Cache API → Workers KV (snapshots only), each with
stale-while-revalidate; plus edge page caching for public pages.

## Regenerating data & assets

```sh
# GeoNames dumps → src/data/{cities,countries}.json
curl -O https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
curl -O https://download.geonames.org/export/dump/countryInfo.txt
curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
npm run geodata -- /path/to/that/folder

npm run brand-assets   # favicons, app icons, notification badge, OG image
```

## Fonts

`DESIGN.md` specifies Martian Grotesk, which is a commercial typeface. The site uses **Archivo** (OFL) as the
grotesk and **Martian Mono** (OFL, by Evil Martians) for figures, both self-hosted via Astro’s Fonts API.
Swap in Martian Grotesk through `astro.config.mjs` once licensed.
# live-aqi
