import { citiesNear, type Place } from '../geo/places';
import { waqi } from '../config';
import { settleWithin } from './cache';
import { describeError } from './http';
import { getLocationReport, getWeather, getWorldSnapshot, type CityReading, type LocationReport } from './reports';
import { nearbyStations, type Station } from './waqi';
import type { Weather } from './open-meteo';

export interface DashboardData {
  place: Place;
  report: LocationReport | null;
  error: string | null;
  weather: { weather: Weather; fetchedAt: number } | null;
  nearbyCities: Array<{ reading: CityReading; distanceKm: number }>;
  stations: Array<Station & { distanceKm: number }>;
}

/** Longest a page waits for an optional section's data before rendering without it. */
const OPTIONAL_WAIT_MS = 2500;

/** Load everything a place dashboard needs, in parallel. Each part fails independently. */
export async function loadDashboard(place: Place): Promise<DashboardData> {
  const [reportRes, weather, world, stations] = await Promise.all([
    getLocationReport(place).then(
      (r) => ({ report: r, error: null }),
      (err) => {
        console.error('[dashboard] report failed:', err);
        return { report: null, error: describeError(err) };
      },
    ),
    getWeather(place),
    // Only feeds "nearby cities": don't hold the page for a world rebuild.
    settleWithin(getWorldSnapshot(), OPTIONAL_WAIT_MS).catch((err) => {
      console.warn('[dashboard] world snapshot unavailable:', err);
      return null;
    }),
    waqi.enabled
      ? nearbyStations(place.lat, place.lon).catch((err) => {
          console.warn('[dashboard] stations unavailable:', err);
          return [];
        })
      : Promise.resolve([]),
  ]);

  let nearbyCities: DashboardData['nearbyCities'] = [];
  if (world) {
    const byId = new Map(world.readings.map((r) => [r.city.id, r]));
    nearbyCities = citiesNear(place.lat, place.lon, { radiusKm: 400, limit: 6, excludeId: place.id, monitoredOnly: true })
      .map(({ city, distanceKm }) => ({ reading: byId.get(city.id)!, distanceKm }))
      .filter((x) => x.reading && x.distanceKm > 2);
  }

  return { place, report: reportRes.report, error: reportRes.error, weather, nearbyCities, stations };
}
