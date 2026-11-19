import type { Place } from './geo/places';
import type { Weather } from './services/open-meteo';

/**
 * Day or night from sunrise/sunset pairs at `nowSec`, or null when the pairs don't
 * cover that moment. Mirrored by the inline script in BaseLayout (keep in sync).
 */
export function dayFromSun(sun: ReadonlyArray<readonly [number, number]> | undefined, nowSec: number): boolean | null {
  if (!sun?.length) return null;
  if (nowSec < sun[0]![0] - 12 * 3600 || nowSec >= sun[sun.length - 1]![1] + 12 * 3600) return null;
  return sun.some(([rise, set]) => nowSec >= rise && nowSec < set);
}

/**
 * Day or night sky for a place: real sunrise/sunset at render time when known,
 * then the weather provider's `is_day` (as of when it was fetched), then the
 * place's local hour when weather is unavailable.
 */
export function skyTheme(place: Pick<Place, 'timezone'>, weather: Weather | null | undefined): 'light' | 'dark' {
  const day = dayFromSun(weather?.sun, Date.now() / 1000);
  if (day !== null) return day ? 'light' : 'dark';
  if (weather) return weather.isDay ? 'light' : 'dark';
  try {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: place.timezone, hour: '2-digit', hour12: false }).format(new Date())) % 24;
    return hour >= 6 && hour < 18 ? 'light' : 'dark';
  } catch {
    return 'light';
  }
}
