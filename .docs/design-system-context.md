# Live AQI design system — context

Read this before changing any UI. Tokens live in `src/styles/global.css`; components are shown at `/styleguide`.

## Source of truth
- **Visual direction:** the "soft sky" day/night mockups supplied by the product owner (November 2026). They
  **supersede** both `DESIGN.md` files (the Evil Martians one in the parent folder and the Lamborghini one here).
- Brand artwork lives in `public/art/`: `sun.webp`, `moon.webp`, `skyline-kuala-lumpur-{day,night}.webp`
  (optimised from the supplied PNGs).
- Product brief: real-time AQI for anyone, anywhere. The first screen answers “is the air safe for me now, and what
  should I do?” in three seconds: the number in its category colour, a face pill, a one-line summary.

## Decisions (agreed with the product owner)
1. **Day / night follows the city.** A dashboard shows the sky over that city right now, using the weather API's
   `is_day` (real sunrise/sunset), falling back to local hour. Pages without a place follow the visitor's local time.
   The header sun/moon button overrides the theme for the browsing session (`sessionStorage['laqi:theme']`); an
   inline script in `BaseLayout` applies it before first paint, so there is no flash.
2. **Kuala Lumpur artwork only on Kuala Lumpur.** Every other place gets `Skyline.astro`: a generated, landmark-free
   skyline in the same flat layered style, seeded by the place slug (stable per city, different between cities).

## Principles
- **Glass over the city.** The AQI card is frosted glass over a sky scene; everything else is calm cards on a soft
  blue-grey page. One focal point: the number.
- **Colour belongs to the data.** Chrome stays blue-grey/navy with one accent blue. Category colours appear in the
  number, pill, scale bar, chart line and badges — always with the category name in text.
- **Both themes are first-class.** Every colour is a CSS variable that changes with `[data-theme]`. Never hard-code a
  hex in a component; for category text use `text-(--num-l) dark:text-(--num-d)` with the category's `text` colours.
- **Calm motion.** Hover/press transitions only; toasts rise in. No looping or decorative animation.
  Every button-like control (`.btn`, `.glass-pill`, `.seg` options, nav pills, anything with `data-press`) gets the
  shared press: a quick scale-down with a soft spring back, plus a light that blooms from the point clicked and fades
  on release (`--lg-ink`, `motion.ts`). Segmented-control thumbs glide to the new option; the phone menu unfolds and
  its icon turns into a close mark. Wide controls set a shallower `--press` inline (e.g. `0.97`).
- **Arrival splash** (`Preloader.astro`): on a new visit, a link from another site or a reload, the mark draws
  itself over the sky (≥ 0.95 s, ≤ 4 s), then lifts while the hero makes its entrance underneath. Never on
  in-site navigation (the page transition covers that) or without JavaScript. Hero animations pause under
  `html.preloading`; `motion.ts` waits for the `laqi:preloaded` event before reveals, count-ups and chart draw-ins.
- **Logo**: the cloud-sun outline on a cyan → deep-navy tile (`Logo.astro`); favicons and app icons are generated
  from the same drawing by `npm run brand-assets`.

## Tokens
| Group | Tokens |
|---|---|
| Surfaces | `bg`, `surface`, `surface-2`, `surface-3`, `glass`, `glass-strong` |
| Text | `ink`, `ink-2`, `ink-3` (≥ 4.5:1 on cards in both themes) |
| Lines | `line`, `line-strong`, `glass-border` |
| Accent | `accent`, `accent-soft`, `accent-ink`, `on-accent` |
| Data | `series-pm25`, `series-pm10`; AQI categories in `src/lib/aqi/standards.ts` (`color`, `ink`, `text.light/dark`, `short`, `face`) |
| Sky scene | `sky-top/mid/bottom`, `city-far/mid/near/front`, `city-window`, `cloud`, `star` |
| Radius | `rounded-xs` 6, `rounded-ui` 12, `rounded-card` 20, `rounded-scene` 28, pills `rounded-full` |
| Motion | `--duration-fast/base/slow`, `--ease-out/in/in-out` |
| Layers | `--z-header/overlay/popover/toast/skip` |

Legacy alias names (`canvas`, `pale`, `muted`, `subtle`, `stage`, `on-stage*`…) map to the tokens above so older
markup keeps working; prefer the new names in new code.

## Components
- Overview: `SkyScene` (+ `Skyline`), `AqiOverviewCard`, `WeatherTiles` (`glass` inside the card on phones, `card` on
  desktop), `TrendCard` (smooth chart, category-coloured line), `InfoCards`.
- AQI atoms: `CategoryPill` (+ `FaceIcon`), `AqiScaleBar`, `PollutantLabel` (real `<sub>`, never Unicode subscripts).
- Layout: `PlaceDashboard`, `Section` (`boxed` wraps content in a card), `Header` (pill tabs, location selector,
  theme toggle), `Footer`.
- CSS components: `.card`, `.tile`, `.glass`, `.glass-tile`, `.btn` (+ `-primary`, `-secondary`), `.chip`, `.seg`,
  `.aqi-badge`, `.swatch`, `.byline`, `.data-table`, `.prose-reading`.

- Weather sky: `SkyScene` takes `weather` + `pm25`; `[data-sky]` tokens (`snow`, `rain`, `drizzle`, `storm`, `overcast`,
  `fog`, `smog`, `smog-heavy`, `heat`) retint `--sky-*`/`--cloud`, dim the sun and stars, and show rooftop snow
  (`--snow-cap`, `.sky-snow` in `Skyline`). Particles, haze and lightning are painted by `src/scripts/weather-fx.ts`
  under the AQI card, so the card stays readable. Preview with `?wx=<preset>`.

## Data honesty in the UI
- The mockup's “17 stations · 16 contributors” only appears when ground-station data (WAQI) is configured; otherwise
  the card states the real source (CAMS model and grid size). Never show sample readings, including in the styleguide.

## Accessibility targets
WCAG 2.2 AA: 4.5:1 text contrast in both themes (large AQI numerals ≥ 3:1), visible focus, 44px touch targets,
category always named in text, keyboard access to charts (arrow keys), `prefers-reduced-motion` honoured.
