import type { APIRoute } from 'astro';
import { error, json, parseCoord } from '../../../lib/api';
import { waqi } from '../../../lib/config';
import { describeError } from '../../../lib/services/http';
import { stationsInBounds } from '../../../lib/services/waqi';

export const prerender = false;

/** Ground stations inside a bounding box (WAQI). bbox = south,west,north,east */
export const GET: APIRoute = async ({ url }) => {
  if (!waqi.enabled) return error(404, 'Station data is not configured');
  const parts = (url.searchParams.get('bbox') ?? '').split(',');
  const [s, w, n, e] = [parseCoord(parts[0] ?? null, 90), parseCoord(parts[1] ?? null, 180), parseCoord(parts[2] ?? null, 90), parseCoord(parts[3] ?? null, 180)];
  if (s === null || w === null || n === null || e === null || s >= n) return error(400, 'Invalid bbox');
  // Keep requests to regional views — the map only asks for stations when zoomed in.
  if (n - s > 30 || Math.abs(e - w) > 60) return error(400, 'Area too large; zoom in');
  try {
    const stations = await stationsInBounds([s, w, n, e]);
    return json(
      {
        type: 'FeatureCollection',
        features: stations
          .filter((st) => st.aqi !== null)
          .slice(0, 1500)
          .map((st) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
            properties: { uid: st.uid, name: st.name.split(';')[0], aqi: st.aqi, time: st.time },
          })),
      },
      { cache: 'public, max-age=600' },
    );
  } catch (err) {
    console.error('[api/map/stations]', err);
    return error(502, describeError(err));
  }
};
