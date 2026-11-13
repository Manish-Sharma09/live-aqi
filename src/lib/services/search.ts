import { categoryFor, defaultStandardFor, type StandardId } from '../aqi/standards';
import { TTL } from '../config';
import {
  CONTINENTS,
  countryName,
  getCityById,
  getCountry,
  searchCities,
  searchCountries,
  searchRegions,
  slugify,
} from '../geo/places';
import { cached } from './cache';
import { geocodeSearch } from './open-meteo';
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

export async function searchPlaces(query: string): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];

  let readings = new Map<number, CityReading>();
  try {
    const snap = await getWorldSnapshot();
    readings = new Map(snap.readings.map((r) => [r.city.id, r]));
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
    try {
      const geo = await cached(`geo:q:${q.toLowerCase()}`, TTL.geocode, () => geocodeSearch(q, 8));
      const seen = new Set(cities.map((c) => c.id));
      for (const g of geo.value) {
        if (seen.has(g.id) || !g.country_code || !g.feature_code?.startsWith('PPL')) continue;
        const local = getCityById(g.id);
        const slug = local ? local.slug : `${slugify(g.name)}-${g.id}`;
        results.push({
          type: local ? 'city' : 'place',
          title: g.name,
          subtitle: [g.admin1, g.country ?? countryName(g.country_code)].filter(Boolean).join(', '),
          href: `/city/${slug}`,
          loc: `s:${slug}`,
          lat: g.latitude,
          lon: g.longitude,
        });
        if (results.length >= 12) break;
      }
    } catch (err) {
      console.warn('[search] geocoding unavailable:', err);
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
