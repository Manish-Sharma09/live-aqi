/**
 * Centralised server-side configuration. Secrets come from `astro:env/server`
 * (Wrangler secrets in production, `.dev.vars` locally) and never reach the client.
 */
import {
  GA_MEASUREMENT_ID,
  OPEN_METEO_API_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT,
  WAQI_TOKEN,
} from 'astro:env/server';

export const SITE = {
  name: 'Live AQI',
  url: 'https://live-aqi.com',
  tagline: 'Real-time air quality, everywhere.',
  defaultCitySlug: 'delhi',
} as const;

export const openMeteo = {
  apiKey: OPEN_METEO_API_KEY || undefined,
  get airQualityUrl() {
    return this.apiKey
      ? 'https://customer-air-quality-api.open-meteo.com/v1/air-quality'
      : 'https://air-quality-api.open-meteo.com/v1/air-quality';
  },
  get forecastUrl() {
    return this.apiKey ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
  },
  get geocodingUrl() {
    return this.apiKey
      ? 'https://customer-geocoding-api.open-meteo.com/v1'
      : 'https://geocoding-api.open-meteo.com/v1';
  },
};

export const waqi = {
  token: WAQI_TOKEN || undefined,
  get enabled() {
    return Boolean(this.token);
  },
  baseUrl: 'https://api.waqi.info',
};

export const push = {
  publicKey: VAPID_PUBLIC_KEY || undefined,
  privateKey: VAPID_PRIVATE_KEY || undefined,
  subject: VAPID_SUBJECT || 'mailto:alerts@live-aqi.com',
  get enabled() {
    return Boolean(this.publicKey && this.privateKey);
  },
};

export const analytics = {
  /** GA4 measurement ID, only if it looks like one ("G-" + letters/digits): it is written into a script. */
  get gaId(): string | undefined {
    const id = GA_MEASUREMENT_ID?.trim().toUpperCase();
    return id && /^G-[A-Z0-9]{4,20}$/.test(id) ? id : undefined;
  },
  get enabled() {
    return Boolean(this.gaId);
  },
};

/** Cache lifetimes (seconds). Fresh window, then served stale while refreshing. */
export const TTL = {
  report: { fresh: 60 * 60, stale: 5 * 60 * 60 },
  weather: { fresh: 30 * 60, stale: 2 * 60 * 60 },
  world: { fresh: 3 * 60 * 60, stale: 3 * 60 * 60 },
  country: { fresh: 3 * 60 * 60, stale: 3 * 60 * 60 },
  geocode: { fresh: 7 * 24 * 60 * 60, stale: 0 },
  stations: { fresh: 15 * 60, stale: 45 * 60 },
} as const;
