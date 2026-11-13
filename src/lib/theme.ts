import type { Place } from './geo/places';
import type { Weather } from './services/open-meteo';

/**
 * Day or night sky for a place: the weather provider's `is_day` (real sunrise /
 * sunset), falling back to the place's local hour when weather is unavailable.
 */
export function skyTheme(place: Pick<Place, 'timezone'>, weather: Weather | null | undefined): 'light' | 'dark' {
  if (weather) return weather.isDay ? 'light' : 'dark';
  try {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: place.timezone, hour: '2-digit', hour12: false }).format(new Date())) % 24;
    return hour >= 6 && hour < 18 ? 'light' : 'dark';
  } catch {
    return 'light';
  }
}
