import type { APIRoute } from 'astro';
import { error, json } from '../../../lib/api';
import { categoryFor } from '../../../lib/aqi/standards';
import { describeError } from '../../../lib/services/http';
import { getWorldSnapshot } from '../../../lib/services/reports';

export const prerender = false;

/** World snapshot as GeoJSON for the map (both standards precomputed). */
export const GET: APIRoute = async () => {
  try {
    const snap = await getWorldSnapshot();
    const features = snap.readings
      .filter((r) => r.us !== null || r.in !== null)
      .map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.city.lon, r.city.lat] },
        properties: {
          id: r.city.id,
          slug: r.city.slug,
          name: r.city.name,
          country: r.country,
          cc: r.city.cc,
          pop: r.city.population,
          us: r.us,
          in: r.in,
          usLevel: r.us === null ? -1 : categoryFor('us', r.us).level,
          inLevel: r.in === null ? -1 : categoryFor('in', r.in).level,
          usDom: r.usDom,
          inDom: r.inDom,
          us24: r.us24,
          in24: r.in24,
          pm25: r.pm25 === null ? null : Math.round(r.pm25 * 10) / 10,
          pm10: r.pm10 === null ? null : Math.round(r.pm10 * 10) / 10,
        },
      }));
    return json(
      {
        type: 'FeatureCollection',
        validTime: snap.validTime,
        fetchedAt: snap.fetchedAt,
        stale: snap.stale,
        requested: snap.requested,
        features,
      },
      { cache: 'public, max-age=600' },
    );
  } catch (err) {
    console.error('[api/map/cities]', err);
    return error(502, describeError(err));
  }
};
