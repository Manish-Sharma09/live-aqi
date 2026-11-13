/**
 * Open-Meteo client — air quality (CAMS), current weather and geocoding.
 * https://open-meteo.com — data: CAMS (Copernicus Atmosphere Monitoring Service),
 * national weather services, GeoNames.
 */
import { openMeteo } from '../config';
import type { PollutantSeries } from '../aqi/compute';
import { fetchJson, UpstreamError } from './http';

const AQ_VARIABLES = {
  pm25: 'pm2_5',
  pm10: 'pm10',
  o3: 'ozone',
  no2: 'nitrogen_dioxide',
  so2: 'sulphur_dioxide',
  co: 'carbon_monoxide',
} as const;

export interface AirQualitySeries {
  /** Hourly timestamps (unix seconds, UTC). */
  time: number[];
  values: PollutantSeries;
  /** Centre of the model grid cell that was used. */
  gridLat: number;
  gridLon: number;
  timezone: string;
}

interface AqResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly?: { time: number[] } & Record<string, Array<number | null>>;
}

export interface Point {
  lat: number;
  lon: number;
}

interface AqRange {
  pastHours: number;
  forecastHours: number;
}

const coord = (n: number) => (Math.round(n * 1000) / 1000).toString();

function withKey(params: URLSearchParams) {
  if (openMeteo.apiKey) params.set('apikey', openMeteo.apiKey);
  return params;
}

/**
 * Hourly concentrations (µg/m³) for one or more points. Multi-point requests
 * are batched; each point still counts against the provider's quota.
 */
export async function fetchAirQuality(points: Point[], range: AqRange): Promise<AirQualitySeries[]> {
  const BATCH = 100;
  const out: AirQualitySeries[] = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    const params = withKey(
      new URLSearchParams({
        latitude: batch.map((p) => coord(p.lat)).join(','),
        longitude: batch.map((p) => coord(p.lon)).join(','),
        hourly: Object.values(AQ_VARIABLES).join(','),
        past_hours: String(range.pastHours),
        forecast_hours: String(range.forecastHours),
        timeformat: 'unixtime',
        timezone: batch.length === 1 ? 'auto' : 'GMT',
        domains: 'auto',
      }),
    );
    const res = await fetchJson<AqResponse | AqResponse[]>(`${openMeteo.airQualityUrl}?${params}`, { timeoutMs: 15000 });
    const list = Array.isArray(res) ? res : [res];
    if (list.length !== batch.length) throw new UpstreamError('invalid', 'Unexpected number of locations in response');
    for (const r of list) {
      if (!r.hourly?.time) throw new UpstreamError('invalid', 'Missing hourly data');
      const h = r.hourly;
      const values = Object.fromEntries(
        Object.entries(AQ_VARIABLES).map(([id, name]) => [id, (h[name] as Array<number | null> | undefined) ?? h.time.map(() => null)]),
      ) as unknown as PollutantSeries;
      out.push({ time: h.time, values, gridLat: r.latitude, gridLon: r.longitude, timezone: r.timezone });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export interface Weather {
  time: number;
  temperature: number | null;
  feelsLike: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windGusts: number | null;
  windDirection: number | null;
  pressure: number | null;
  uvIndex: number | null;
  weatherCode: number | null;
  isDay: boolean;
}

interface WeatherResponse {
  current?: Record<string, number | null> & { time: number };
}

export async function fetchWeather(p: Point): Promise<Weather> {
  const params = withKey(
    new URLSearchParams({
      latitude: coord(p.lat),
      longitude: coord(p.lon),
      current:
        'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,uv_index',
      wind_speed_unit: 'kmh',
      timeformat: 'unixtime',
      timezone: 'auto',
    }),
  );
  const res = await fetchJson<WeatherResponse>(`${openMeteo.forecastUrl}?${params}`);
  const c = res.current;
  if (!c) throw new UpstreamError('invalid', 'Missing current weather');
  const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : null);
  return {
    time: c.time,
    temperature: n('temperature_2m'),
    feelsLike: n('apparent_temperature'),
    humidity: n('relative_humidity_2m'),
    windSpeed: n('wind_speed_10m'),
    windGusts: n('wind_gusts_10m'),
    windDirection: n('wind_direction_10m'),
    pressure: n('surface_pressure'),
    uvIndex: n('uv_index'),
    weatherCode: n('weather_code'),
    isDay: c.is_day === 1,
  };
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  feature_code?: string;
  country_code?: string;
  country?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
}

export async function geocodeSearch(name: string, count = 8): Promise<GeoResult[]> {
  const params = withKey(new URLSearchParams({ name, count: String(count), language: 'en', format: 'json' }));
  const res = await fetchJson<{ results?: GeoResult[] }>(`${openMeteo.geocodingUrl}/search?${params}`, { timeoutMs: 6000 });
  return res.results ?? [];
}

export async function geocodeById(id: number): Promise<GeoResult | null> {
  const params = withKey(new URLSearchParams({ id: String(id) }));
  try {
    const res = await fetchJson<GeoResult & { error?: boolean }>(`${openMeteo.geocodingUrl}/get?${params}`, { timeoutMs: 6000 });
    return res && typeof res.id === 'number' ? res : null;
  } catch (err) {
    if (err instanceof UpstreamError && err.status && err.status >= 400 && err.status < 500) return null;
    throw err;
  }
}

/** WMO weather interpretation codes → short description. */
export function describeWeatherCode(code: number | null): string {
  if (code === null) return '—';
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Mixed conditions';
}
