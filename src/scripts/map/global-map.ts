/**
 * Global AQI map (MapLibre GL + OpenFreeMap vector tiles). Loaded lazily by
 * /map only. City markers come from the shared world snapshot; ground stations
 * (WAQI) are fetched per viewport when zoomed in and the token is configured.
 */
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { categoryFor, STANDARDS, type StandardId } from '../../lib/aqi/standards';
import { POLLUTANTS } from '../../lib/aqi/pollutants';
import type { PollutantId } from '../../lib/aqi/standards';

setWorkerUrl(workerUrl);

type GeoData = Parameters<GeoJSONSource['setData']>[0];
type Filter = NonNullable<Parameters<MapLibreMap['setFilter']>[1]>;
type PointGeometry = { type: 'Point'; coordinates: [number, number] };
const errorOf = async (r: Response) => ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`;

interface CityProps {
  id: number;
  slug: string;
  name: string;
  country: string;
  cc: string;
  pop: number;
  us: number | null;
  in: number | null;
  usLevel: number;
  inLevel: number;
  usDom: PollutantId | null;
  inDom: PollutantId | null;
  us24: number | null;
  in24: number | null;
  pm25: number | null;
  pm10: number | null;
}

interface CitiesResponse {
  type: 'FeatureCollection';
  validTime: number;
  fetchedAt: number;
  stale: boolean;
  requested: number;
  features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: CityProps }>;
}

export interface MapOptions {
  container: HTMLElement;
  panel: HTMLElement;
  stationsEnabled: boolean;
}

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
const currentTheme = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
const FONT = ['Noto Sans Bold'];
const STATION_MIN_ZOOM = 6;

export async function initGlobalMap({ container, panel, stationsEnabled }: MapOptions) {
  const params = new URLSearchParams(location.search);
  let standard: StandardId = params.get('std') === 'in' ? 'in' : 'us';
  let showStations = stationsEnabled && params.get('layer') === 'stations';
  const activeLevels = new Set([0, 1, 2, 3, 4, 5]);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const z = Number(params.get('z'));
  const hasView = params.has('lat') && Number.isFinite(lat) && Number.isFinite(lon);

  const el = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel);
  const status = el<HTMLElement>('[data-map-status]')!;
  const say = (msg: string) => {
    status.textContent = msg;
    status.hidden = !msg;
  };

  const map = new MapLibreMap({
    container,
    style: STYLES[currentTheme()],
    center: hasView ? [lon, lat] : [20, 24],
    // Fit the whole inhabited world to the container width by default.
    zoom: hasView ? (Number.isFinite(z) && z > 0 ? z : 9) : Math.max(0.6, Math.log2(container.clientWidth / 512) + 0.2),
    minZoom: 0.5,
    maxZoom: 14,
    attributionControl: { compact: true },
    renderWorldCopies: true,
    cooperativeGestures: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  // Development-only handle for automated interaction tests (removed from production builds).
  if (import.meta.env.DEV) (window as unknown as { __laqiMap?: MapLibreMap }).__laqiMap = map;
  map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: false }, trackUserLocation: false }), 'bottom-right');

  // ------------------------------------------------------------- city data
  let data: CitiesResponse | null = null;
  const dataPromise = fetch('/api/map/cities')
    .then(async (r) => {
      if (!r.ok) throw new Error(await errorOf(r));
      return (await r.json()) as CitiesResponse;
    })
    .catch((err: Error) => {
      say(`City readings could not be loaded: ${err.message}. The base map still works — try again in a few minutes.`);
      return null;
    });

  const decorate = (fc: CitiesResponse) => {
    for (const f of fc.features) {
      const p = f.properties as CityProps & Record<string, unknown>;
      for (const std of ['us', 'in'] as const) {
        const v = p[std];
        const c = v === null ? null : categoryFor(std, v);
        p[`${std}Color`] = c?.color ?? '#555555';
        p[`${std}Ink`] = c?.ink ?? '#ffffff';
        p[`${std}Label`] = v === null ? '' : String(v);
      }
    }
    return fc;
  };

  const levelProp = () => (standard === 'us' ? 'usLevel' : 'inLevel');
  const filterExpr = (): Filter => ['in', ['get', levelProp()], ['literal', [...activeLevels]]];

  await new Promise<void>((resolve) => map.on('load', () => resolve()));
  data = await dataPromise;

  let stationData: unknown = null;
  function addDataLayers() {
    map.addSource('cities', { type: 'geojson', data: (data ?? { type: 'FeatureCollection', features: [] }) as unknown as GeoData });
    map.addLayer({
      id: 'city-dots',
      type: 'circle',
      source: 'cities',
      filter: filterExpr(),
      paint: {
        'circle-color': ['get', `${standard}Color`],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0.5, 4, 2.5, 6, 3, 12, 6, 15],
        'circle-stroke-color': currentTheme() === 'dark' ? '#081229' : '#ffffff',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 1, 4, 2],
      },
    });
    map.addLayer({
      id: 'city-values',
      type: 'symbol',
      source: 'cities',
      minzoom: 3,
      filter: filterExpr(),
      layout: {
        'text-field': ['get', `${standard}Label`],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 6, 12],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': ['get', `${standard}Ink`] },
    });
    map.addLayer({
      id: 'city-names',
      type: 'symbol',
      source: 'cities',
      minzoom: 4,
      filter: filterExpr(),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': 11,
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: currentTheme() === 'dark'
        ? { 'text-color': '#ffffff', 'text-halo-color': '#081229', 'text-halo-width': 1.5 }
        : { 'text-color': '#1b2942', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });

    // ---------------------------------------------------------- stations layer
    map.addSource('stations', { type: 'geojson', data: (stationData ?? { type: 'FeatureCollection', features: [] }) as unknown as GeoData });
    map.addLayer({
      id: 'station-dots',
      type: 'circle',
      source: 'stations',
      layout: { visibility: showStations ? 'visible' : 'none' },
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 10, 11],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: 'station-values',
      type: 'symbol',
      source: 'stations',
      minzoom: 9,
      layout: { visibility: showStations ? 'visible' : 'none', 'text-field': ['to-string', ['get', 'aqi']], 'text-font': FONT, 'text-size': 10, 'text-allow-overlap': true },
      paint: { 'text-color': ['get', 'ink'] },
    });
  }
  if (data) decorate(data);
  addDataLayers();

  let stationTimer: ReturnType<typeof setTimeout> | undefined;
  let stationAbort: AbortController | undefined;
  async function loadStations() {
    if (!showStations) return;
    if (map.getZoom() < STATION_MIN_ZOOM) {
      (map.getSource('stations') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
      say('Zoom in to a city or region to see ground monitoring stations.');
      return;
    }
    const b = map.getBounds();
    const bbox = [b.getSouth(), Math.max(b.getWest(), -180), b.getNorth(), Math.min(b.getEast(), 180)].map((n) => n.toFixed(3)).join(',');
    stationAbort?.abort();
    stationAbort = new AbortController();
    try {
      const r = await fetch(`/api/map/stations?bbox=${bbox}`, { signal: stationAbort.signal });
      if (!r.ok) throw new Error(await errorOf(r));
      const fc = (await r.json()) as { features: Array<{ properties: { aqi: number; color?: string; ink?: string } }> };
      for (const f of fc.features) {
        const c = categoryFor('us', f.properties.aqi);
        f.properties.color = c.color;
        f.properties.ink = c.ink;
      }
      stationData = fc;
      (map.getSource('stations') as GeoJSONSource).setData(fc as unknown as GeoData);
      say(fc.features.length ? '' : 'No reporting stations in this area.');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') say(`Station data unavailable: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- popups
  const popup = new Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'laqi-popup', focusAfterOpen: true });

  function cityPopup(p: CityProps): HTMLElement {
    const v = standard === 'us' ? p.us : p.in;
    const dom = standard === 'us' ? p.usDom : p.inDom;
    const past = standard === 'us' ? p.us24 : p.in24;
    const root = document.createElement('div');
    root.className = 'space-y-2';
    const h = document.createElement('p');
    h.className = 'text-base font-bold leading-tight';
    h.textContent = p.name;
    const sub = document.createElement('p');
    sub.className = 'text-xs text-subtle';
    sub.textContent = p.country;
    root.appendChild(h);
    root.appendChild(sub);
    if (v !== null) {
      const c = categoryFor(standard, v);
      const row = document.createElement('p');
      row.className = 'flex items-center gap-2';
      const badge = document.createElement('span');
      badge.className = 'aqi-badge';
      badge.style.setProperty('--cat', c.color);
      badge.style.setProperty('--cat-ink', c.ink);
      badge.textContent = String(v);
      const lab = document.createElement('span');
      lab.className = 'text-sm font-semibold';
      lab.textContent = `${c.label}`;
      row.appendChild(badge);
      row.appendChild(lab);
      root.appendChild(row);
      const meta = document.createElement('p');
      meta.className = 'font-mono text-xs text-subtle';
      const delta = past === null ? '' : ` · 24 h ${v - past > 0 ? '+' : ''}${v - past}`;
      meta.textContent = `${STANDARDS[standard].shortName}${dom ? ` · primary ${POLLUTANTS[dom].ascii}` : ''}${p.pm25 !== null ? ` · PM2.5 ${p.pm25}` : ''}${delta}`;
      root.appendChild(meta);
    }
    const a = document.createElement('a');
    a.href = `/city/${p.slug}${standard === 'in' && p.cc !== 'IN' ? '?std=in' : standard === 'us' && p.cc === 'IN' ? '?std=us' : ''}`;
    a.className = 'inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4';
    a.textContent = 'Open the full dashboard';
    root.appendChild(a);
    return root;
  }

  map.on('click', 'city-dots', (e) => {
    const f = e.features?.[0] as MapGeoJSONFeature | undefined;
    if (!f) return;
    const coords = (f.geometry as unknown as PointGeometry).coordinates;
    popup.setLngLat(coords).setDOMContent(cityPopup(f.properties as unknown as CityProps)).addTo(map);
  });
  map.on('click', 'station-dots', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as { name: string; aqi: number; time?: string };
    const c = categoryFor('us', p.aqi);
    const root = document.createElement('div');
    root.className = 'space-y-1.5';
    const t = document.createElement('p');
    t.className = 'font-bold leading-tight';
    t.textContent = p.name;
    const row = document.createElement('p');
    row.className = 'flex items-center gap-2 text-sm';
    const badge = document.createElement('span');
    badge.className = 'aqi-badge';
    badge.style.setProperty('--cat', c.color);
    badge.style.setProperty('--cat-ink', c.ink);
    badge.textContent = String(p.aqi);
    const lab = document.createElement('span');
    lab.textContent = `US AQI · ${c.label}`;
    row.appendChild(badge);
    row.appendChild(lab);
    const note = document.createElement('p');
    note.className = 'text-xs text-subtle';
    note.textContent = `Ground station via WAQI${p.time ? ` · ${String(p.time).slice(0, 16).replace('T', ' ')}` : ''}`;
    root.appendChild(t);
    root.appendChild(row);
    root.appendChild(note);
    popup.setLngLat((f.geometry as unknown as PointGeometry).coordinates).setDOMContent(root).addTo(map);
  });
  for (const layer of ['city-dots', 'station-dots']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  // ------------------------------------------------------------- panel UI
  const countsEls = panel.querySelectorAll<HTMLElement>('[data-level-count]');
  const legendLabels = panel.querySelectorAll<HTMLElement>('[data-level-label]');
  const legendRanges = panel.querySelectorAll<HTMLElement>('[data-level-range]');
  const legendSwatches = panel.querySelectorAll<HTMLElement>('[data-level-swatch]');
  const inView = el<HTMLOListElement>('[data-in-view]')!;
  const meta = el<HTMLElement>('[data-map-meta]')!;

  function refreshLegend() {
    const cats = STANDARDS[standard].categories;
    cats.forEach((c, i) => {
      if (legendLabels[i]) legendLabels[i]!.textContent = c.label;
      if (legendRanges[i]) legendRanges[i]!.textContent = c.max === Infinity ? `${c.min}+` : `${c.min}–${c.max}`;
      legendSwatches[i]?.style.setProperty('--cat', c.color);
      const n = data ? data.features.filter((f) => f.properties[standard === 'us' ? 'usLevel' : 'inLevel'] === c.level).length : 0;
      if (countsEls[i]) countsEls[i]!.textContent = String(n);
    });
  }

  function refreshInView() {
    if (!data) return;
    const b = map.getBounds();
    const rows = data.features
      .filter((f) => {
        const p = f.properties;
        const v = standard === 'us' ? p.us : p.in;
        return v !== null && activeLevels.has(standard === 'us' ? p.usLevel : p.inLevel) && b.contains(f.geometry.coordinates as [number, number]);
      })
      .sort((a, b2) => (standard === 'us' ? b2.properties.us! - a.properties.us! : b2.properties.in! - a.properties.in!))
      .slice(0, 8);
    inView.replaceChildren(
      ...rows.map((f) => {
        const p = f.properties;
        const v = (standard === 'us' ? p.us : p.in)!;
        const c = categoryFor(standard, v);
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `/city/${p.slug}`;
        a.className = 'flex items-center gap-3 py-2 hover:underline';
        const badge = document.createElement('span');
        badge.className = 'aqi-badge';
        badge.style.setProperty('--cat', c.color);
        badge.style.setProperty('--cat-ink', c.ink);
        badge.textContent = String(v);
        const name = document.createElement('span');
        name.className = 'min-w-0 flex-1 truncate text-sm';
        name.textContent = `${p.name}, ${p.country}`;
        a.appendChild(badge);
        a.appendChild(name);
        li.appendChild(a);
        return li;
      }),
    );
    if (rows.length === 0) {
      const li = document.createElement('li');
      li.className = 'py-2 text-sm text-on-stage-muted';
      li.textContent = 'No monitored cities in view with the selected categories.';
      inView.appendChild(li);
    }
  }

  function applyStandard() {
    map.setPaintProperty('city-dots', 'circle-color', ['get', `${standard}Color`]);
    map.setLayoutProperty('city-values', 'text-field', ['get', `${standard}Label`]);
    map.setPaintProperty('city-values', 'text-color', ['get', `${standard}Ink`]);
    for (const id of ['city-dots', 'city-values', 'city-names']) map.setFilter(id, filterExpr());
    panel.querySelectorAll<HTMLButtonElement>('[data-std]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.std === standard)));
    refreshLegend();
    refreshInView();
    popup.remove();
    syncUrl();
  }

  function syncUrl() {
    const c = map.getCenter();
    const p = new URLSearchParams();
    p.set('lat', c.lat.toFixed(3));
    p.set('lon', c.lng.toFixed(3));
    p.set('z', map.getZoom().toFixed(1));
    if (standard === 'in') p.set('std', 'in');
    if (showStations) p.set('layer', 'stations');
    history.replaceState(null, '', `${location.pathname}?${p}`);
  }

  panel.querySelectorAll<HTMLButtonElement>('[data-std]').forEach((b) =>
    b.addEventListener('click', () => {
      standard = b.dataset.std === 'in' ? 'in' : 'us';
      applyStandard();
    }),
  );
  panel.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) =>
    b.addEventListener('click', () => {
      const lvl = Number(b.dataset.level);
      if (activeLevels.has(lvl)) activeLevels.delete(lvl);
      else activeLevels.add(lvl);
      b.setAttribute('aria-pressed', String(activeLevels.has(lvl)));
      for (const id of ['city-dots', 'city-values', 'city-names']) map.setFilter(id, filterExpr());
      refreshInView();
    }),
  );
  const stationToggle = el<HTMLInputElement>('[data-stations-toggle]');
  if (stationToggle) {
    stationToggle.checked = showStations;
    stationToggle.addEventListener('change', () => {
      showStations = stationToggle.checked;
      for (const id of ['station-dots', 'station-values']) map.setLayoutProperty(id, 'visibility', showStations ? 'visible' : 'none');
      if (showStations) loadStations();
      else say('');
      syncUrl();
    });
  }

  panel.addEventListener('laqi:search-select', (e) => {
    const r = (e as CustomEvent<{ lat?: number; lon?: number; type: string; href: string; title: string }>).detail;
    if (r.lat === undefined || r.lon === undefined) {
      location.assign(r.href);
      return;
    }
    map.flyTo({ center: [r.lon, r.lat], zoom: r.type === 'station' ? 11 : r.type === 'country' ? 4 : 8, essential: true });
    const match = data?.features.find((f) => Math.abs(f.geometry.coordinates[0] - r.lon!) < 0.05 && Math.abs(f.geometry.coordinates[1] - r.lat!) < 0.05);
    if (match) {
      map.once('moveend', () => popup.setLngLat(match.geometry.coordinates).setDOMContent(cityPopup(match.properties)).addTo(map));
    } else {
      map.once('moveend', () => {
        const root = document.createElement('div');
        const t = document.createElement('p');
        t.className = 'font-bold';
        t.textContent = r.title;
        const a = document.createElement('a');
        a.href = r.href;
        a.className = 'mt-2 inline-block text-sm font-semibold underline underline-offset-4';
        a.textContent = 'Open the full dashboard';
        root.appendChild(t);
        root.appendChild(a);
        popup.setLngLat([r.lon!, r.lat!]).setDOMContent(root).addTo(map);
      });
    }
  });

  map.on('moveend', () => {
    refreshInView();
    syncUrl();
    clearTimeout(stationTimer);
    stationTimer = setTimeout(loadStations, 350);
  });

  if (data) {
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).format(data.validTime * 1000);
    meta.textContent = `${data.features.length} of ${data.requested} cities · valid ${time}${data.stale ? ' · showing last available data' : ''}`;
  }
  applyStandard();
  if (showStations) loadStations();

  // Day/night toggle: swap the basemap, then rebuild the data layers on top.
  window.addEventListener('laqi:theme-change', () => {
    map.setStyle(STYLES[currentTheme()], { diff: false });
    map.once('style.load', () => {
      addDataLayers();
      applyStandard();
      for (const id of ['station-dots', 'station-values']) map.setLayoutProperty(id, 'visibility', showStations ? 'visible' : 'none');
    });
  });
  document.querySelector('[data-map-loading]')?.remove();
  container.setAttribute('aria-busy', 'false');
}
