/**
 * OpenStreetMap places: the villages and small towns GeoNames (Open-Meteo's
 * geocoder) doesn't list, e.g. Jibhi in Himachal Pradesh.
 *
 * - Search uses Photon (komoot), which is built for search-as-you-type.
 * - A place's page looks it up by OSM id on Nominatim (lookup only, never
 *   autocomplete, per its usage policy); results are cached for a week.
 *
 * Data © OpenStreetMap contributors (ODbL), credited in the footer.
 */
import { normalize, slugify } from '../geo/places';
import { fetchJson } from './http';

export type OsmType = 'N' | 'W' | 'R';

export interface OsmPlace {
  osmType: OsmType;
  osmId: number;
  name: string;
  /** County / tehsil, or the district (e.g. "Banjar", "Kullu"). */
  district?: string | undefined;
  region?: string | undefined;
  country?: string | undefined;
  /** ISO 3166-1 alpha-2, upper case. */
  cc: string;
  lat: number;
  lon: number;
}

/** Settlements only, not islands, counties, single farms or states. */
const SETTLEMENTS = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood', 'locality', 'municipality']);

const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/lookup';

/** Page slug for an OSM place: `jibhi-n5118693019`. */
export function osmSlug(p: Pick<OsmPlace, 'name' | 'osmType' | 'osmId'>): string {
  return `${slugify(p.name) || 'place'}-${p.osmType.toLowerCase()}${p.osmId}`;
}

/** Parse an OSM place slug, or null when the slug isn't one. */
export function parseOsmSlug(slug: string): { osmType: OsmType; osmId: number } | null {
  const m = /^.*-([nwr])(\d{1,12})$/.exec(slug);
  return m ? { osmType: m[1]!.toUpperCase() as OsmType, osmId: Number(m[2]) } : null;
}

/** Drop a sub-area that just repeats the place's own name ("Kalpa, Kalpa, …"). */
const distinct = (name: string, area: string | undefined) => (area && normalize(area) !== normalize(name) ? area : undefined);

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    county?: string;
    district?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

/** Settlements matching `q`, in Photon's order (most notable first). */
export async function photonSearch(q: string, limit = 10): Promise<OsmPlace[]> {
  const params = new URLSearchParams({ q, limit: String(limit), lang: 'en', osm_tag: 'place' });
  const res = await fetchJson<{ features?: PhotonFeature[] }>(`${PHOTON_URL}?${params}`, { timeoutMs: 4000 });
  const out: OsmPlace[] = [];
  for (const f of res.features ?? []) {
    const p = f.properties;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const type = p?.osm_type?.toUpperCase();
    if (!p?.name || !p.countrycode || !p.osm_id || lat === undefined || lon === undefined) continue;
    if (p.osm_key !== 'place' || !SETTLEMENTS.has(p.osm_value ?? '') || (type !== 'N' && type !== 'W' && type !== 'R')) continue;
    out.push({
      osmType: type,
      osmId: p.osm_id,
      name: p.name,
      district: distinct(p.name, p.county ?? p.district),
      region: p.state,
      country: p.country,
      cc: p.countrycode.toUpperCase(),
      lat,
      lon,
    });
  }
  return out;
}

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  /** What it is as an address, e.g. "city" for a town mapped as a boundary relation. */
  addresstype?: string;
  name?: string;
  address?: Record<string, string | undefined>;
}

/** One settlement by OSM id, or null when it doesn't exist or isn't a settlement. */
export async function osmLookup(osmType: OsmType, osmId: number): Promise<OsmPlace | null> {
  const params = new URLSearchParams({ osm_ids: `${osmType}${osmId}`, format: 'jsonv2', addressdetails: '1', 'accept-language': 'en' });
  const [p] = await fetchJson<NominatimPlace[]>(`${NOMINATIM_URL}?${params}`, { timeoutMs: 6000 });
  const a = p?.address ?? {};
  const lat = Number(p?.lat);
  const lon = Number(p?.lon);
  if (!p?.name || !a.country_code || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Photon lists towns mapped as boundaries (place=city on an admin relation) as places;
  // Nominatim reports those as boundary/administrative with addresstype "city".
  const settlement =
    (p.category === 'place' && SETTLEMENTS.has(p.type ?? '')) || (p.category === 'boundary' && SETTLEMENTS.has(p.addresstype ?? ''));
  if (!settlement) return null;
  return {
    osmType,
    osmId,
    name: p.name,
    district: distinct(p.name, a.state_district ?? a.county),
    region: a.state ?? a.region ?? a.province,
    country: a.country,
    cc: a.country_code.toUpperCase(),
    lat,
    lon,
  };
}
