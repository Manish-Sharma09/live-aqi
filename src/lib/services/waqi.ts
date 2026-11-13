/**
 * World Air Quality Index Project (waqi.info) — optional ground-station data.
 * Enabled only when WAQI_TOKEN is configured. WAQI reports every value on the
 * US EPA scale (station sub-indices, not concentrations), so it is shown as a
 * separate, clearly labelled layer and never mixed into model-based numbers.
 */
import { TTL, waqi } from '../config';
import { distanceKm } from '../geo/places';
import { cached } from './cache';
import { fetchJson, UpstreamError } from './http';

export interface Station {
  uid: number;
  name: string;
  lat: number;
  lon: number;
  /** US EPA scale. Null when the station is offline ("-"). */
  aqi: number | null;
  /** ISO-like local timestamp reported by the station, when available. */
  time: string | null;
}

interface BoundsResponse {
  status: string;
  data: Array<{ uid: number; lat: number; lon: number; aqi: string; station: { name: string; time?: string } }> | string;
}

interface SearchResponse {
  status: string;
  data:
    | Array<{
        uid: number;
        aqi: string;
        time?: { stime?: string };
        station: { name: string; geo: [number, number]; country?: string };
      }>
    | string;
}

const toAqi = (v: string | number | undefined): number | null => {
  const n = typeof v === 'number' ? v : Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const round = (n: number, step: number) => Math.round(n / step) * step;

/** Stations within a bounding box [south, west, north, east]. */
export async function stationsInBounds(bbox: [number, number, number, number]): Promise<Station[]> {
  if (!waqi.enabled) return [];
  const step = 0.25;
  const [s, w, n, e] = [round(bbox[0], step), round(bbox[1], step), round(bbox[2], step), round(bbox[3], step)];
  const key = `waqi:bounds:${s},${w},${n},${e}`;
  const res = await cached(key, TTL.stations, async () => {
    const url = `${waqi.baseUrl}/map/bounds?latlng=${s},${w},${n},${e}&networks=all&token=${encodeURIComponent(waqi.token!)}`;
    const body = await fetchJson<BoundsResponse>(url, { timeoutMs: 8000 });
    if (body.status !== 'ok' || !Array.isArray(body.data)) {
      throw new UpstreamError('http', typeof body.data === 'string' ? body.data : 'WAQI error');
    }
    return body.data.map<Station>((d) => ({
      uid: d.uid,
      name: d.station.name,
      lat: d.lat,
      lon: d.lon,
      aqi: toAqi(d.aqi),
      time: d.station.time ?? null,
    }));
  });
  return res.value;
}

export async function nearbyStations(lat: number, lon: number, radiusKm = 40, limit = 8): Promise<Array<Station & { distanceKm: number }>> {
  if (!waqi.enabled) return [];
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  const list = await stationsInBounds([lat - dLat, lon - dLon, lat + dLat, lon + dLon]);
  return list
    .map((s) => ({ ...s, distanceKm: distanceKm(lat, lon, s.lat, s.lon) }))
    .filter((s) => s.distanceKm <= radiusKm && s.aqi !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

export async function searchStations(keyword: string, limit = 4): Promise<Station[]> {
  if (!waqi.enabled || keyword.trim().length < 3) return [];
  const key = `waqi:search:${keyword.trim().toLowerCase()}`;
  const res = await cached(key, TTL.stations, async () => {
    const url = `${waqi.baseUrl}/search/?keyword=${encodeURIComponent(keyword.trim())}&token=${encodeURIComponent(waqi.token!)}`;
    const body = await fetchJson<SearchResponse>(url, { timeoutMs: 6000 });
    if (body.status !== 'ok' || !Array.isArray(body.data)) return [];
    return body.data.map<Station>((d) => ({
      uid: d.uid,
      name: d.station.name,
      lat: d.station.geo[0],
      lon: d.station.geo[1],
      aqi: toAqi(d.aqi),
      time: d.time?.stime ?? null,
    }));
  });
  return res.value.slice(0, limit);
}
