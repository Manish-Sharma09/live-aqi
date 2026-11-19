import type { APIRoute } from 'astro';
import { error, json, parseCoord } from '../../lib/api';
import { placeFromCoordinates } from '../../lib/services/reports';

export const prerender = false;

/** Browser geolocation → a location token and display name. Coordinates are rounded to ~1 km. */
export const GET: APIRoute = ({ url }) => {
  const lat = parseCoord(url.searchParams.get('lat'), 90);
  const lon = parseCoord(url.searchParams.get('lon'), 180);
  if (lat === null || lon === null) return error(400, 'Invalid coordinates');
  const place = placeFromCoordinates(lat, lon);
  if (!place) return error(404, 'No nearby place found');
  const token = place.kind === 'city' ? `s:${place.slug}` : `g:${place.lat.toFixed(1)},${place.lon.toFixed(1)}`;
  return json({
    token,
    name: place.name,
    subtitle: [place.region, place.country].filter(Boolean).join(', '),
    href: `/city/${place.slug}`,
  });
};
