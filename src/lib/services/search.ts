import { categoryFor, defaultStandardFor, type StandardId } from '../aqi/standards';
import { TTL } from '../config';
import {
  CONTINENTS,
  countryName,
  distanceKm,
  getCityById,
  getCountry,
  isCityNamed,
  nearestCity,
  normalize,
  searchCities,
  searchCountries,
  searchRegions,
  slugify,
} from '../geo/places';
import { cached, settleWithin } from './cache';
import { geocodeSearch, type GeoResult } from './open-meteo';
import { osmSlug, photonSearch, type OsmPlace } from './osm';
import { getWorldSnapshot, readingValue, type CityReading } from './reports';
import { searchStations } from './waqi';

export interface AqiPreview {
  value: number;
  standard: StandardId;
  label: string;
  color: string;
}

export interface SearchResult {
  type: 'city' | 'place' | 'country' | 'region' | 'station';
  title: string;
  subtitle: string;
  href: string;
  /** Location token, when the result can be saved as "my location". */
  loc?: string;
  lat?: number;
  lon?: number;
  aqi?: AqiPreview;
}

function preview(reading: CityReading | undefined, cc: string): AqiPreview | undefined {
  if (!reading) return undefined;
  const standard = defaultStandardFor(cc);
  const value = readingValue(reading, standard);
  if (value === null) return undefined;
  const cat = categoryFor(standard, value);
  return { value, standard, label: cat.label, color: cat.color };
}

/**
 * How well a remote place's name answers the query: 0 exact ("kalpa", or
 * "kalpa kinnaur" with the rest naming where it is), 1 prefix, 2 a later word
 * of the name; null = not a match (Photon also returns look-alikes such as
 * "Jibei" for "jibhi"). `context` = the place's district/state/country, checked
 * against the rest of the query; 'matched' when the source already matched the
 * rest against the full address (Photon does, but doesn't return every level).
 */
function matchTier(name: string, query: string, context: Array<string | undefined> | 'matched'): number | null {
  const n = normalize(name);
  const q = normalize(query);
  if (!n || !q) return null;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (q.startsWith(`${n} `)) {
    if (context === 'matched') return 0;
    const where = normalize(context.filter(Boolean).join(' ')).split(' ');
    const rest = q.slice(n.length + 1).split(' ');
    if (rest.every((w) => where.some((x) => x.startsWith(w)))) return 0;
  }
  if (n.includes(` ${q}`)) return 2;
  return null;
}

interface Candidate {
  result: SearchResult;
  name: string;
  lat: number;
  lon: number;
  cc: string;
  tier: number;
  /** Position in the source's own ranking; OSM (Photon) ranks by notability, so it leads. */
  rank: number;
}

/**
 * Towns and villages beyond the local dataset, from GeoNames (Open-Meteo) and
 * OpenStreetMap (Photon) together: GeoNames misses many villages (Jibhi), and
 * returns same-named places unranked (six Kalpas, Himachal's second). The same
 * place from both sources is shown once. Ordered by name match, then the
 * visitor's country, then notability.
 */
async function remotePlaces(q: string, exclude: Set<number>, country: string | undefined): Promise<SearchResult[]> {
  const key = q.toLowerCase();
  const [gn, osm] = await Promise.allSettled([
    cached(`geo:q:${key}`, TTL.geocode, () => geocodeSearch(q, 8)),
    cached(`osm:q:${key}`, TTL.geocode, () => photonSearch(q, 10)),
  ]);
  if (gn.status === 'rejected') console.warn('[search] geocoding unavailable:', gn.reason);
  if (osm.status === 'rejected') console.warn('[search] OSM search unavailable:', osm.reason);

  const candidates: Candidate[] = [];
  const geoList: GeoResult[] = gn.status === 'fulfilled' ? gn.value.value : [];
  geoList.forEach((g, i) => {
    if (exclude.has(g.id) || !g.country_code || !g.feature_code?.startsWith('PPL')) return;
    const local = getCityById(g.id);
    const slug = local ? local.slug : `${slugify(g.name)}-${g.id}`;
    const district = g.admin2 && normalize(g.admin2) !== normalize(g.name) ? g.admin2 : undefined;
    candidates.push({
      result: {
        type: local ? 'city' : 'place',
        title: g.name,
        subtitle: [district, g.admin1, g.country ?? countryName(g.country_code)].filter(Boolean).join(', '),
        href: `/city/${slug}`,
        loc: `s:${slug}`,
        lat: g.latitude,
        lon: g.longitude,
      },
      name: g.name,
      lat: g.latitude,
      lon: g.longitude,
      cc: g.country_code.toUpperCase(),
      tier: matchTier(g.name, q, [g.admin2, g.admin1, g.country]) ?? 2,
      rank: 100 + i,
    });
  });

  const sameName = (a: string, b: string) => normalize(a) === normalize(b);
  const osmList: OsmPlace[] = osm.status === 'fulfilled' ? osm.value.value : [];
  osmList.forEach((p, i) => {
    const tier = matchTier(p.name, q, 'matched');
    if (tier === null) return;
    // Already listed by GeoNames: keep that entry (its page already exists), at OSM's rank.
    const twin = candidates.find((c) => sameName(c.name, p.name) && distanceKm(c.lat, c.lon, p.lat, p.lon) <= 5);
    if (twin) {
      twin.rank = Math.min(twin.rank, i);
      return;
    }
    // A dataset city (or its former name, "Gurgaon"): link its page rather than an OSM one.
    const near = nearestCity(p.lat, p.lon);
    const local = near && near.distanceKm <= 15 && isCityNamed(near.city, p.name) ? near.city : undefined;
    if (local && exclude.has(local.id)) return;
    const slug = local ? local.slug : osmSlug(p);
    candidates.push({
      result: {
        type: local ? 'city' : 'place',
        title: p.name,
        subtitle: [p.district, p.region, getCountry(p.cc)?.name ?? p.country].filter(Boolean).join(', '),
        href: `/city/${slug}`,
        loc: `s:${slug}`,
        lat: p.lat,
        lon: p.lon,
      },
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      cc: p.cc,
      tier,
      rank: i,
    });
  });

  const home = country?.toUpperCase();
  return candidates
    .sort((a, b) => a.tier - b.tier || Number(b.cc === home) - Number(a.cc === home) || a.rank - b.rank)
    .map((c) => c.result);
}

export async function searchPlaces(query: string, opts: { country?: string | undefined } = {}): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];

  let readings = new Map<number, CityReading>();
  try {
    // Previews only: answer quickly rather than wait for a world rebuild.
    const snap = await settleWithin(getWorldSnapshot(), 1500);
    if (snap) readings = new Map(snap.readings.map((r) => [r.city.id, r]));
  } catch {
    /* previews are optional */
  }

  const results: SearchResult[] = [];
  const cities = searchCities(q, 7);
  for (const c of cities) {
    const country = countryName(c.cc);
    results.push({
      type: 'city',
      title: c.name,
      subtitle: [c.region, country].filter(Boolean).join(', '),
      href: `/city/${c.slug}`,
      loc: `s:${c.slug}`,
      lat: c.lat,
      lon: c.lon,
      ...(preview(readings.get(c.id), c.cc) ? { aqi: preview(readings.get(c.id), c.cc)! } : {}),
    });
  }

  for (const country of searchCountries(q, 2)) {
    results.push({
      type: 'country',
      title: country.name,
      subtitle: `Country · ${CONTINENTS[country.continent] ?? ''}`,
      href: `/country/${country.slug}`,
    });
  }

  for (const r of searchRegions(q, 2)) {
    const country = getCountry(r.cc);
    if (!country) continue;
    results.push({
      type: 'region',
      title: r.name,
      subtitle: `Region · ${country.name}`,
      href: `/country/${country.slug}?region=${encodeURIComponent(r.code)}`,
    });
  }

  // Smaller towns: remote geocoding, only when local matches are thin.
  if (cities.length < 4 && q.length >= 3) {
    for (const r of await remotePlaces(q, new Set(cities.map((c) => c.id)), opts.country)) {
      results.push(r);
      if (results.length >= 12) break;
    }
  }

  try {
    for (const s of await searchStations(q, 3)) {
      results.push({
        type: 'station',
        title: s.name.split(';')[0]!.trim(),
        subtitle: `Monitoring station${s.aqi !== null ? ` · US AQI ${s.aqi}` : ''}`,
        href: `/map?lat=${s.lat.toFixed(4)}&lon=${s.lon.toFixed(4)}&z=11&layer=stations`,
        lat: s.lat,
        lon: s.lon,
        ...(s.aqi !== null
          ? { aqi: { value: s.aqi, standard: 'us' as const, label: categoryFor('us', s.aqi).label, color: categoryFor('us', s.aqi).color } }
          : {}),
      });
    }
  } catch (err) {
    console.warn('[search] stations unavailable:', err);
  }

  return results.slice(0, 14);
}
