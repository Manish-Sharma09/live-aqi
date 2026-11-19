/**
 * What the sky over a place should show: precipitation, storm, fog, smog and heat,
 * derived from the current weather (WMO weather code, temperature, wind) and PM2.5.
 * Rendered by SkyScene.astro (CSS sky tints, snow on rooftops) and painted by
 * src/scripts/weather-fx.ts. Pure and shared by server and browser.
 */
import type { Weather } from '../services/open-meteo';

export type Precip = 'none' | 'drizzle' | 'rain' | 'snow';

export interface SkyWeather {
  precip: Precip;
  /** Precipitation intensity, 0–1. */
  amount: number;
  /** Thunderstorm: lightning. */
  storm: boolean;
  /** Cloud deck over the sky. */
  overcast: boolean;
  /** Fog density, 0–1. */
  fog: number;
  /** Visible pollution haze from PM2.5, 0–1. */
  smog: number;
  /** Daytime heat shimmer, 0–1. */
  heat: number;
  /** Sideways wind, -1 (to the left) … 1 (to the right). */
  wind: number;
}

export const CLEAR_SKY: SkyWeather = { precip: 'none', amount: 0, storm: false, overcast: false, fog: 0, smog: 0, heat: 0, wind: 0 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** WMO weather code → precipitation, storm, fog and cloud cover. */
function fromCode(code: number | null): Pick<SkyWeather, 'precip' | 'amount' | 'storm' | 'overcast' | 'fog'> {
  const none = { precip: 'none' as const, amount: 0, storm: false, overcast: false, fog: 0 };
  if (code === null) return none;
  if (code === 3) return { ...none, overcast: true };
  if (code === 45) return { ...none, overcast: true, fog: 0.85 };
  if (code === 48) return { ...none, overcast: true, fog: 0.95 }; // rime fog
  const p = (precip: Precip, amount: number, storm = false) => ({ precip, amount, storm, overcast: true, fog: 0 });
  switch (code) {
    case 51: return p('drizzle', 0.35);
    case 53: return p('drizzle', 0.55);
    case 55: return p('drizzle', 0.8);
    case 56: return p('drizzle', 0.45);
    case 57: return p('drizzle', 0.8);
    case 61: return p('rain', 0.35);
    case 63: return p('rain', 0.6);
    case 65: return p('rain', 0.9);
    case 66: return p('rain', 0.4);
    case 67: return p('rain', 0.8);
    case 71: return p('snow', 0.35);
    case 73: return p('snow', 0.6);
    case 75: return p('snow', 0.95);
    case 77: return p('snow', 0.3); // snow grains
    case 80: return p('rain', 0.45);
    case 81: return p('rain', 0.7);
    case 82: return p('rain', 1);
    case 85: return p('snow', 0.5);
    case 86: return p('snow', 0.9);
    case 95: return p('rain', 0.7, true);
    case 96:
    case 99: return p('rain', 0.85, true); // with hail
    default: return none;
  }
}

/** The sky for a place's current weather and PM2.5 (µg/m³). */
export function skyWeather(w: Weather | null | undefined, pm25: number | null | undefined): SkyWeather {
  const sky: SkyWeather = { ...CLEAR_SKY, ...fromCode(w?.weatherCode ?? null) };
  if (w?.windSpeed != null) {
    // Wind direction is where it blows FROM; the screen shows the east–west part of where it goes.
    const toward = w.windDirection != null ? -Math.sin((w.windDirection * Math.PI) / 180) : 0.3;
    sky.wind = Math.max(-1, Math.min(1, clamp01(w.windSpeed / 45) * toward));
  }
  if (pm25 != null && Number.isFinite(pm25)) {
    // Haze becomes visible around 30 µg/m³ and is thick by 250 (India "Severe" territory).
    sky.smog = clamp01((pm25 - 30) / 220) * (sky.precip === 'none' ? 1 : 0.6);
  }
  if (w && w.isDay && sky.precip === 'none' && sky.fog === 0) {
    const t = Math.max(w.temperature ?? -99, (w.feelsLike ?? -99) - 3);
    sky.heat = clamp01((t - 33) / 9);
  }
  return sky;
}

/** Space-separated hooks for CSS (`[data-sky~='snow']`); 'clear' when nothing applies. */
export function skyTokens(s: SkyWeather): string {
  const t: string[] = [];
  if (s.precip !== 'none') t.push(s.precip);
  if (s.storm) t.push('storm');
  if (s.overcast || s.precip !== 'none' || s.fog > 0.3) t.push('overcast');
  if (s.fog > 0.3) t.push('fog');
  if (s.smog > 0.08) t.push('smog');
  if (s.smog > 0.5) t.push('smog-heavy');
  if (s.heat > 0.05) t.push('heat');
  return t.join(' ') || 'clear';
}

/** Whether the canvas has anything to paint. */
export function hasWeatherEffects(s: SkyWeather): boolean {
  return s.precip !== 'none' || s.storm || s.overcast || s.fog > 0.05 || s.smog > 0.08 || s.heat > 0.05;
}

/**
 * Preview any sky on any page with `?wx=<preset>` (combine with commas: `?wx=snow,smog`).
 * Client-side only; for checking the effects without waiting for the weather.
 */
export const SKY_PRESETS: Record<string, Partial<SkyWeather>> = {
  clear: {},
  overcast: { overcast: true },
  drizzle: { precip: 'drizzle', amount: 0.55, overcast: true, wind: 0.1 },
  rain: { precip: 'rain', amount: 0.65, overcast: true, wind: 0.25 },
  storm: { precip: 'rain', amount: 0.95, storm: true, overcast: true, wind: 0.55 },
  snow: { precip: 'snow', amount: 0.6, overcast: true, wind: 0.15 },
  blizzard: { precip: 'snow', amount: 1, overcast: true, wind: 0.85 },
  fog: { fog: 0.9, overcast: true },
  smog: { smog: 0.75 },
  heat: { heat: 0.9 },
};

export function presetSky(spec: string): SkyWeather | null {
  const names = spec.toLowerCase().split(/[,+\s]+/).filter((n) => n in SKY_PRESETS);
  if (!names.length) return null;
  const s: SkyWeather = { ...CLEAR_SKY };
  for (const n of names) {
    const p = SKY_PRESETS[n]!;
    if (p.precip && p.precip !== 'none') s.precip = p.precip;
    s.amount = Math.max(s.amount, p.amount ?? 0);
    s.storm ||= p.storm ?? false;
    s.overcast ||= p.overcast ?? false;
    s.fog = Math.max(s.fog, p.fog ?? 0);
    s.smog = Math.max(s.smog, p.smog ?? 0);
    s.heat = Math.max(s.heat, p.heat ?? 0);
    if (Math.abs(p.wind ?? 0) > Math.abs(s.wind)) s.wind = p.wind!;
  }
  return s;
}
