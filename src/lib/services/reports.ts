/**
 * Domain layer: turns raw provider data into the reports the UI renders.
 * UI components never call providers directly — only these functions.
 */
import { computeAqi, currentHourIndex, latestConcentrations, max8hMeanIn24h, trailingMean, type AqiResult, type PollutantSeries } from '../aqi/compute';
import { POLLUTANT_IDS, categoryFor, type PollutantId, type StandardId } from '../aqi/standards';
import { TTL } from '../config';
import {
  cityToPlace,
  countryName,
  getCityById,
  getCityBySlug,
  getCountry,
  monitoredCities,
  citiesInCountry,
  distinctCities,
  distanceKm,
  isCityNamed,
  nearestCity,
  resolveAlias,
  slugify,
  type City,
  type Place,
} from '../geo/places';
import { cached, prewarm } from './cache';
import { fetchAirQuality, fetchWeather, geocodeById, type AirQualitySeries, type Weather } from './open-meteo';
import { osmLookup, osmSlug, parseOsmSlug } from './osm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataSource {
  provider: string;
  providerUrl: string;
  dataset: string;
  kind: 'model';
  gridLat: number;
  gridLon: number;
}

export interface CurrentReading {
  /** Hour the values are valid for (unix seconds, UTC). */
  time: number;
  aqi: Record<StandardId, AqiResult | null>;
  /** Latest hourly concentration at or shortly before `time` (µg/m³; CO in mg/m³). */
  concentrations: Partial<Record<PollutantId, number>>;
  /** 24-hour means ending at `time` (µg/m³; CO in mg/m³). */
  means24: Partial<Record<PollutantId, number>>;
  /** Highest 8-hour mean within the 24 h ending at `time`, for O3 and CO (µg/m³; CO in mg/m³). */
  means8: Partial<Record<'o3' | 'co', number>>;
}

export interface TrendData {
  times: number[];
  nowIndex: number;
  us: Array<number | null>;
  in: Array<number | null>;
  pm25: Array<number | null>;
  pm10: Array<number | null>;
  timezone: string;
}

export interface CategoryEvent {
  time: number;
  fromLevel: number;
  toLevel: number;
  aqi: number;
}

export interface ChangeSummary {
  h1: number | null;
  h3: number | null;
  h24: number | null;
  events: CategoryEvent[];
}

export interface LocationReport {
  place: Place;
  source: DataSource;
  fetchedAt: number;
  stale: boolean;
  current: CurrentReading;
  trend: TrendData;
  changes: Record<StandardId, ChangeSummary>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nowSec = () => Math.floor(Date.now() / 1000);
const key2 = (n: number) => n.toFixed(2);

function inEuropeDomain(lat: number, lon: number) {
  return lat >= 30 && lat <= 72 && lon >= -25 && lon <= 45;
}

function describeSource(s: AirQualitySeries): DataSource {
  return {
    provider: 'Open-Meteo',
    providerUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    dataset: inEuropeDomain(s.gridLat, s.gridLon) ? 'CAMS European air-quality forecast (≈11 km)' : 'CAMS global atmospheric composition forecast (≈45 km)',
    kind: 'model',
    gridLat: s.gridLat,
    gridLon: s.gridLon,
  };
}

function mean(values: ReadonlyArray<number | null>, end: number, len: number, minValid: number, scale = 1) {
  const m = trailingMean(values, end, len, minValid);
  return m === null ? undefined : m / scale;
}

// ---------------------------------------------------------------------------
// Location report
// ---------------------------------------------------------------------------

const REPORT_PAST_HOURS = 8 * 24; // 7 days shown + 24 h averaging warm-up
const REPORT_FORECAST_HOURS = 72; // 48 h shown + headroom while cached

async function loadSeries(lat: number, lon: number) {
  return cached(`aq:${key2(lat)},${key2(lon)}`, TTL.report, async () => {
    const [s] = await fetchAirQuality([{ lat, lon }], { pastHours: REPORT_PAST_HOURS, forecastHours: REPORT_FORECAST_HOURS });
    return s!;
  });
}

function buildCurrent(series: PollutantSeries, t: number, time: number): CurrentReading {
  const means24: Partial<Record<PollutantId, number>> = {};
  for (const p of POLLUTANT_IDS) {
    const v = mean(series[p], t, 24, 16, p === 'co' ? 1000 : 1);
    if (v !== undefined) means24[p] = v;
  }
  // 8-hour guidelines (WHO O₃, India O₃/CO) are set on the day's highest 8-hour mean,
  // so compare against the max 8-h mean of the last 24 h — the same value the India
  // sub-index uses — not just the latest 8 hours.
  const means8: Partial<Record<'o3' | 'co', number>> = {};
  const o3 = max8hMeanIn24h(series.o3, t);
  const co = max8hMeanIn24h(series.co, t);
  if (o3 !== null) means8.o3 = o3;
  if (co !== null) means8.co = co / 1000;
  return {
    time,
    aqi: { us: computeAqi('us', series, t), in: computeAqi('in', series, t) },
    concentrations: latestConcentrations(series, t),
    means24,
    means8,
  };
}

function summariseChanges(values: Array<number | null>, nowIdx: number, times: number[], standard: StandardId): ChangeSummary {
  const at = (i: number) => (i >= 0 && i < values.length ? values[i] : null) ?? null;
  const now = at(nowIdx);
  const delta = (h: number) => {
    const past = at(nowIdx - h);
    return now !== null && past !== null ? now - past : null;
  };
  const events: CategoryEvent[] = [];
  for (let i = Math.max(1, nowIdx - 47); i <= nowIdx; i++) {
    const a = at(i - 1);
    const b = at(i);
    if (a === null || b === null) continue;
    const la = categoryFor(standard, a).level;
    const lb = categoryFor(standard, b).level;
    if (la !== lb) events.push({ time: times[i]!, fromLevel: la, toLevel: lb, aqi: b });
  }
  return { h1: delta(1), h3: delta(3), h24: delta(24), events: events.reverse().slice(0, 6) };
}

export async function getLocationReport(place: Place): Promise<LocationReport> {
  const { value: s, fetchedAt, stale } = await loadSeries(place.lat, place.lon);
  const t = currentHourIndex(s.time, nowSec());
  if (t < 0) throw new Error('No current hour in data');

  // Trend window: 7 days back, 48 h ahead (bounded by the data we have).
  const from = Math.max(0, t - 7 * 24 + 1);
  const to = Math.min(s.time.length - 1, t + 48);
  const times = s.time.slice(from, to + 1);
  const us: Array<number | null> = [];
  const ind: Array<number | null> = [];
  for (let i = from; i <= to; i++) {
    us.push(computeAqi('us', s.values, i)?.aqi ?? null);
    ind.push(computeAqi('in', s.values, i)?.aqi ?? null);
  }
  const nowIndex = t - from;

  return {
    place,
    source: describeSource(s),
    fetchedAt,
    stale,
    current: buildCurrent(s.values, t, s.time[t]!),
    trend: {
      times,
      nowIndex,
      us,
      in: ind,
      pm25: s.values.pm25.slice(from, to + 1).map((v) => v ?? null),
      pm10: s.values.pm10.slice(from, to + 1).map((v) => v ?? null),
      timezone: place.timezone,
    },
    changes: {
      us: summariseChanges(us, nowIndex, times, 'us'),
      in: summariseChanges(ind, nowIndex, times, 'in'),
    },
  };
}

export async function getWeather(place: Place): Promise<{ weather: Weather; fetchedAt: number } | null> {
  try {
    const r = await cached(`wx:${key2(place.lat)},${key2(place.lon)}`, TTL.weather, () => fetchWeather(place));
    return { weather: r.value, fetchedAt: r.fetchedAt };
  } catch (err) {
    console.warn('[weather] unavailable:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Snapshots (world + country/region) — precomputed hourly slots
// ---------------------------------------------------------------------------

const SLOTS = 6;

interface CitySlots {
  id: number;
  us: Array<number | null>;
  in: Array<number | null>;
  usDom: Array<PollutantId | null>;
  inDom: Array<PollutantId | null>;
  pm25: Array<number | null>;
  pm10: Array<number | null>;
  us24: Array<number | null>;
  in24: Array<number | null>;
}

interface SnapshotData {
  startHour: number;
  cities: CitySlots[];
  /** Hourly median AQI across cities (area snapshots only). */
  trend?: { times: number[]; us: Array<number | null>; in: Array<number | null> };
  requested: number;
}

export interface CityReading {
  city: City;
  country: string;
  validTime: number;
  us: number | null;
  in: number | null;
  usDom: PollutantId | null;
  inDom: PollutantId | null;
  pm25: number | null;
  pm10: number | null;
  us24: number | null;
  in24: number | null;
}

export interface Snapshot {
  readings: CityReading[];
  validTime: number;
  fetchedAt: number;
  stale: boolean;
  requested: number;
  trend?: { times: number[]; us: Array<number | null>; in: Array<number | null> } | undefined;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

async function buildSnapshot(cities: readonly City[], pastHours: number, withTrend: boolean): Promise<SnapshotData> {
  const series = await fetchAirQuality(
    cities.map((c) => ({ lat: c.lat, lon: c.lon })),
    { pastHours, forecastHours: SLOTS + 2 },
  );
  const now = nowSec();
  let startHour = 0;
  const trendUs: number[][] = [];
  const trendIn: number[][] = [];
  let trendTimes: number[] = [];

  const out = series.map((s, i): CitySlots => {
    const t = currentHourIndex(s.time, now);
    if (i === 0) startHour = s.time[t] ?? now - (now % 3600);
    const slots: CitySlots = { id: cities[i]!.id, us: [], in: [], usDom: [], inDom: [], pm25: [], pm10: [], us24: [], in24: [] };
    for (let k = 0; k < SLOTS; k++) {
      const ti = t + k;
      const us = ti < s.time.length ? computeAqi('us', s.values, ti) : null;
      const ind = ti < s.time.length ? computeAqi('in', s.values, ti) : null;
      slots.us.push(us?.aqi ?? null);
      slots.in.push(ind?.aqi ?? null);
      slots.usDom.push(us?.dominant ?? null);
      slots.inDom.push(ind?.dominant ?? null);
      slots.pm25.push(s.values.pm25[ti] ?? null);
      slots.pm10.push(s.values.pm10[ti] ?? null);
      slots.us24.push(computeAqi('us', s.values, ti - 24)?.aqi ?? null);
      slots.in24.push(computeAqi('in', s.values, ti - 24)?.aqi ?? null);
    }
    if (withTrend && t >= 0) {
      const from = Math.max(24, t - 7 * 24 + 1);
      if (i === 0) trendTimes = s.time.slice(from, t + 1);
      for (let k = 0; k < trendTimes.length; k++) {
        const ti = from + k;
        const u = computeAqi('us', s.values, ti)?.aqi;
        const n = computeAqi('in', s.values, ti)?.aqi;
        (trendUs[k] ??= []);
        (trendIn[k] ??= []);
        if (u !== undefined) trendUs[k]!.push(u);
        if (n !== undefined) trendIn[k]!.push(n);
      }
    }
    return slots;
  });

  return {
    startHour,
    cities: out,
    requested: cities.length,
    ...(withTrend
      ? { trend: { times: trendTimes, us: trendTimes.map((_, k) => median(trendUs[k] ?? [])), in: trendTimes.map((_, k) => median(trendIn[k] ?? [])) } }
      : {}),
  };
}

function readSnapshot(data: SnapshotData, lookup: Map<number, City>, fetchedAt: number, stale: boolean): Snapshot {
  const slot = Math.min(Math.max(Math.floor((nowSec() - data.startHour) / 3600), 0), SLOTS - 1);
  const validTime = data.startHour + slot * 3600;
  const readings: CityReading[] = [];
  for (const c of data.cities) {
    const city = lookup.get(c.id);
    if (!city) continue;
    readings.push({
      city,
      country: countryName(city.cc),
      validTime,
      us: c.us[slot] ?? null,
      in: c.in[slot] ?? null,
      usDom: c.usDom[slot] ?? null,
      inDom: c.inDom[slot] ?? null,
      pm25: c.pm25[slot] ?? null,
      pm10: c.pm10[slot] ?? null,
      us24: c.us24[slot] ?? null,
      in24: c.in24[slot] ?? null,
    });
  }
  return { readings, validTime, fetchedAt, stale, requested: data.requested, trend: data.trend };
}

const WORLD_KEY = 'world:v3';

/** Global snapshot of ~300 major cities. Shared across all visitors via KV. */
export async function getWorldSnapshot(): Promise<Snapshot> {
  const cities = monitoredCities();
  const res = await cached(WORLD_KEY, { ...TTL.world, kv: true }, () => buildSnapshot(cities, 48, false));
  return readSnapshot(res.value, new Map(cities.map((c) => [c.id, c])), res.fetchedAt, res.stale);
}

/**
 * Called by the 30-minute cron: rebuild the world snapshot shortly before it stops
 * being fresh, so page requests only ever read it. Same upstream usage as before
 * (one rebuild per ~3 h), but no visitor waits for it.
 */
export function prewarmWorldSnapshot(): Promise<boolean> {
  const cities = monitoredCities();
  return prewarm(WORLD_KEY, { ...TTL.world, kv: true }, () => buildSnapshot(cities, 48, false), TTL.world.fresh - 30 * 60);
}

/** Country (or region within a country) snapshot: the most populous cities + 7-day median trend. */
export async function getAreaSnapshot(cc: string, admin1?: string): Promise<Snapshot> {
  const all = citiesInCountry(cc);
  const cities = distinctCities(admin1 ? all.filter((c) => c.admin1 === admin1) : all, admin1 ? 20 : 30);
  if (cities.length === 0) return { readings: [], validTime: nowSec(), fetchedAt: Date.now(), stale: false, requested: 0 };
  const key = `area:v3:${cc}:${admin1 ?? '*'}`;
  const res = await cached(key, { ...TTL.country, kv: true }, () => buildSnapshot(cities, 8 * 24, true));
  return readSnapshot(res.value, new Map(cities.map((c) => [c.id, c])), res.fetchedAt, res.stale);
}

export function readingValue(r: CityReading, std: StandardId) {
  return std === 'us' ? r.us : r.in;
}

export function readingDominant(r: CityReading, std: StandardId) {
  return std === 'us' ? r.usDom : r.inDom;
}

export function readingChange(r: CityReading, std: StandardId): number | null {
  const now = readingValue(r, std);
  const past = std === 'us' ? r.us24 : r.in24;
  return now !== null && past !== null ? now - past : null;
}

// ---------------------------------------------------------------------------
// Place resolution
// ---------------------------------------------------------------------------

export type SlugResolution = { place: Place } | { redirect: string } | null;

/**
 * Resolve `/city/[slug]`: dataset cities, aliases, `<name>-<geonamesId>` places, or
 * `<name>-n<osmId>` (also -w / -r) OpenStreetMap places that GeoNames doesn't list.
 */
export async function resolveCitySlug(slug: string): Promise<SlugResolution> {
  const clean = slug.toLowerCase();
  const city = getCityBySlug(clean);
  if (city) return { place: cityToPlace(city) };
  const alias = resolveAlias(clean);
  if (alias) return { redirect: `/city/${alias}` };

  const osm = parseOsmSlug(clean);
  if (osm) {
    const hit = await cached(`osm:id:${osm.osmType}${osm.osmId}`, TTL.geocode, () => osmLookup(osm.osmType, osm.osmId));
    const p = hit.value;
    if (!p) return null;
    const canonical = osmSlug(p);
    if (canonical !== clean) return { redirect: `/city/${canonical}` };
    // The same town is already a dataset city: use its page.
    const near = nearestCity(p.lat, p.lon);
    if (near && near.distanceKm <= 15 && isCityNamed(near.city, p.name)) return { redirect: `/city/${near.city.slug}` };
    return {
      place: {
        kind: 'place',
        id: null,
        slug: canonical,
        name: p.name,
        region: p.region,
        cc: p.cc,
        country: getCountry(p.cc)?.name ?? p.country ?? p.cc,
        lat: p.lat,
        lon: p.lon,
        timezone: timezoneNear(p.lat, p.lon, p.cc),
      },
    };
  }

  const m = /^(.*)-(\d{3,10})$/.exec(clean);
  if (!m) return null;
  const id = Number(m[2]);
  const known = getCityById(id);
  if (known) return { redirect: `/city/${known.slug}` };
  const geo = await cached(`geo:id:${id}`, TTL.geocode, () => geocodeById(id));
  const g = geo.value;
  if (!g || !g.country_code) return null;
  const canonical = `${slugify(g.name)}-${g.id}`;
  if (canonical !== clean) return { redirect: `/city/${canonical}` };
  return {
    place: {
      kind: 'place',
      id: g.id,
      slug: canonical,
      name: g.name,
      region: g.admin1,
      cc: g.country_code,
      country: g.country ?? countryName(g.country_code),
      lat: g.latitude,
      lon: g.longitude,
      timezone: g.timezone ?? 'UTC',
      population: g.population,
    },
  };
}

/** OSM has no time zones: borrow the nearest dataset city's, in the same country when there is one. */
function timezoneNear(lat: number, lon: number, cc: string): string {
  let best: City | undefined;
  let bestD = Infinity;
  for (const c of citiesInCountry(cc)) {
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return (best ?? nearestCity(lat, lon)?.city)?.timezone ?? 'UTC';
}

/** Href for a place's dashboard. */
export function placeHref(place: Pick<Place, 'slug'>): string {
  return `/city/${place.slug}`;
}

/**
 * Location token stored in the `laqi_loc` cookie / localStorage:
 *   `s:<slug>`        a city page slug
 *   `g:<lat>,<lon>`   coordinates (rounded to 0.1°, about 11 km)
 */
export async function resolveLocationToken(token: string | undefined): Promise<Place | null> {
  if (!token) return null;
  if (token.startsWith('s:')) {
    const r = await resolveCitySlug(token.slice(2));
    if (r && 'place' in r) return r.place;
    if (r && 'redirect' in r) {
      const again = await resolveCitySlug(r.redirect.replace('/city/', ''));
      return again && 'place' in again ? again.place : null;
    }
    return null;
  }
  if (token.startsWith('g:')) {
    const [lat, lon] = token.slice(2).split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat!) > 90 || Math.abs(lon!) > 180) return null;
    return placeFromCoordinates(lat!, lon!);
  }
  return null;
}

/**
 * Coordinates are snapped to 0.1°, which is no finer than the air-quality models' grid
 * (≈11 km in Europe, ≈45 km elsewhere), so the reading barely changes. This bounds the
 * number of distinct cache keys, and so the upstream calls a client can trigger.
 */
const snap = (n: number) => Math.round(n * 10) / 10;

/** Nearest known city within 10 km, otherwise a coordinate-based place named after it. */
export function placeFromCoordinates(lat: number, lon: number): Place | null {
  const near = nearestCity(lat, lon);
  if (!near) return null;
  if (near.distanceKm <= 10) return cityToPlace(near.city);
  const base = cityToPlace(near.city);
  return {
    ...base,
    kind: 'place',
    id: null,
    name: `Near ${near.city.name}`,
    lat: snap(lat),
    lon: snap(lon),
    population: undefined,
  };
}

export function defaultPlace(): Place {
  return cityToPlace(getCityBySlug('delhi')!);
}

export { getCountry };
