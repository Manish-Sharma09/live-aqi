# SEO keywords: Live AQI

Source: Google Trends, India, related queries for "AQI" (top + rising), exported 18 Nov 2026.
The 88 raw queries were merged into 62 keywords: word-order variants count as one ("aqi delhi" = "delhi aqi" = "aqi in delhi"),
with their interest added together. Full list: `seo-keywords.csv`.

Trends interest is relative (100 = the most-searched query), not a search volume.

## Shortlist and where each keyword is used

| Cluster | Best keywords (combined interest) | Target page | Where it appears |
|---|---|---|---|
| City + AQI today | delhi aqi (229), delhi aqi today (93), noida aqi (31), gurgaon aqi (26), mumbai aqi (26), bangalore aqi (13), ghaziabad aqi (10), pune aqi (10), lucknow aqi (8), kolkata aqi (7), new delhi aqi (7), hyderabad aqi (6), jaipur aqi (6), kanpur aqi (4, +10%) | `/city/<slug>` | Title `<City> AQI Today — Live Air Quality Index & Pollution`, description, H1 ("<City> AQI today" for screen readers), "<City> AQI today: common questions" section |
| City modifiers | today, live, pollution, highest ("highest aqi in delhi", +10%) | `/city/<slug>` | Title/description; question "What was the highest AQI in <City> recently?" |
| Alternative names | gurgaon (not gurugram), bangalore (not bengaluru) | `/city/gurugram`, `/city/bengaluru` | "Gurugram (Gurgaon)" in title, description and first question; footer link text (`src/lib/seo.ts`) |
| Generic "now / near me" | aqi today (107), live aqi (16), aqi near me (12), aqi my location (10), current aqi (7) | `/` | Home title `Live AQI – AQI Today Near Me \| Real-Time Air Quality Index` and description (home page already shows the visitor's location) |
| Informational | aqi index (9, +9%), aqi level (8), air quality (8), what is aqi (7), aqi meaning / aqi means (7), air quality index (5, +9%), aqi full form (5) | `/what-is-aqi` (new) | Title `What Is AQI? Full Form, Meaning & AQI Levels Chart`, H1, sections for full form, levels tables (India + US), good AQI, calculation, pollutants; linked from the footer and every city page |
| Country | aqi india (15) | `/country/india` | Title `India AQI Today — Live Air Quality Index & City Rankings` (same pattern for every country) |
| Map | aqi map (5) | `/map` | Title `AQI Map — Live Air Quality Map of India & the World`, H1 "Live AQI map" |
| Rankings | aqi rankings (rising) | `/rankings` | Title `AQI Ranking: Most Polluted Cities in the World Today` |
| Weather (secondary) | delhi weather / weather delhi (8) | `/city/<slug>` | Section heading "Weather in <City>" |

## Internal links and sitemap

- Footer "Popular" column on every page: Delhi, Noida, Gurgaon, Mumbai, Bangalore, Ghaziabad AQI. Noida, Gurugram and
  Ghaziabad aren't in the ~300-city monitored set or the India page's city list, so before this the home, India and
  ranking pages never linked to them.
- `/what-is-aqi` links the 15 most-searched city pages.
- Every city in `POPULAR_CITIES` (`src/lib/seo.ts`) is always in the sitemap at priority 0.8. That adds Shimla, which is
  below the 250k population cutoff.

## Dropped

| Query | Why |
|---|---|
| delhi (98) | Too broad: not an AQI search on its own |
| lahore aqi, dubai aqi | Outside the India audience (their pages exist anyway) |
| goa aqi, aqi dwarka | No matching city page (Goa is a state; Dwarka is a Delhi locality) |

No `<meta name="keywords">` tag was added: Google ignores it and Bing treats it as a spam signal. Keywords go into titles,
descriptions, headings, body copy and link text instead.

## Technical SEO (18 Nov 2026)

- **One URL per city:** `/city/Delhi` now 301-redirects to `/city/delhi`. Production already 301-redirects trailing
  slashes (`trailingSlash: 'never'`); the dev server returns 404 for them instead.
- **Outages return 503 + `Retry-After: 600`** on the city, country, rankings and world pages, so Google retries later
  instead of indexing the "data unavailable" state.
- **Structured data:** city `WebPage` has `dateModified` = the reading's hour; rankings pages have an `ItemList` of the
  ranked cities; `/what-is-aqi` is an `Article` with breadcrumbs.
- **Sitemap:** adds the 12 continent rankings, e.g. `/rankings?region=AS`, which targets "most polluted cities in Asia".
- **Already fine:** one H1 per page, canonical URLs that drop `?std=`, image alt text, real 404s, `/api/` disallowed,
  pages ~30–50 KB gzipped.
- **Open:** the arrival splash (`Preloader.astro`) holds the first screen for about 1–4 s for every visitor who
  arrives from another site, Google included. That delays LCP (Core Web Vitals) for search traffic.

## On-page content and site pages (19 Nov 2026)

- **Home page copy** (`src/components/home/HomeAbout.astro`, ~900 words) below the world rankings: "AQI today", "live
  air quality index", "AQI near me", India NAQI vs US AQI, popular city links, data sources, alerts. Aside card shows both
  AQI scales from the same tables the dashboards use.
- **Home FAQ** (`src/components/home/HomeFaq.astro`): 12 questions from the informational cluster ("aqi full form",
  "good aqi level", "highest aqi", …). Content lives in `src/lib/content/home-faq.ts`, which also builds the `FAQPage`
  JSON-LD, so structured data always matches the visible answers.
- **New pages:** `/contact` (`ContactPage` JSON-LD), `/terms`, and a `500.astro` error page (noindex, `no-store`).
  `/contact` and `/terms` are in the sitemap and the footer.
- **Google Analytics 4:** off until `GA_MEASUREMENT_ID` is set in `wrangler.jsonc`; ad signals off, analytics cookies
  denied by default in the EEA/UK/CH (Consent Mode v2).
- **workers.dev:** `X-Robots-Tag: noindex` on `*.workers.dev` hosts so only live-aqi.com gets indexed.
- **Sitemap index:** `/sitemap-index.xml` lists `/sitemap-0.xml` (all URLs; a new `-1`, `-2`… file is added every
  45,000 URLs). URL rules live in `src/lib/sitemap.ts`. The old `/sitemap.xml` 301-redirects to the index; `robots.txt`
  and the `<link rel="sitemap">` point to the index.

## Refreshing

Re-export the two Trends CSVs, then update `POPULAR_CITIES` / `SEARCH_NAMES` in `src/lib/seo.ts` if the city order or the
searched names change.
