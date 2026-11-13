/**
 * Client-side persistence for the visitor's saved location and alert settings.
 * localStorage holds the full record; a first-party cookie mirrors the location
 * token so the server can render the right dashboard on the homepage.
 */

export interface SavedLocation {
  /** `s:<slug>` or `g:<lat>,<lon>` */
  token: string;
  name: string;
  subtitle?: string;
  href?: string;
  precise?: boolean;
  savedAt: number;
}

/** 1 = Moderate/Satisfactory … 5 = Hazardous/Severe; 6 = severe alerts only. */
export type ThresholdLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface AlertSettings {
  /** 'auto' follows the location's country (India → NAQI, otherwise US EPA). */
  standard: 'auto' | 'us' | 'in';
  /** Category level that triggers an alert (1 = Moderate/Satisfactory … 5 = Hazardous/Severe). */
  threshold: ThresholdLevel;
  severe: boolean;
  improve: boolean;
  inPage: boolean;
  /** Location to watch. Falls back to the saved "my location" when unset. */
  location?: { token: string; name: string } | undefined;
}

export const DEFAULT_ALERTS: AlertSettings = { standard: 'auto', threshold: 3, severe: true, improve: true, inPage: true };

const LOC_KEY = 'laqi:location';
const ALERT_KEY = 'laqi:alerts';
const SEEN_KEY = 'laqi:last-seen';
const COOKIE = 'laqi_loc';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — cookie still works */
  }
}

function setCookie(value: string | null) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    value === null
      ? `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function getCookieToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)laqi_loc=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function getSavedLocation(): SavedLocation | null {
  const loc = read<SavedLocation>(LOC_KEY);
  // Keep the cookie in sync if it was cleared independently.
  if (loc && getCookieToken() !== loc.token) setCookie(loc.token);
  return loc;
}

export function saveLocation(loc: Omit<SavedLocation, 'savedAt'>) {
  const record: SavedLocation = { ...loc, savedAt: Date.now() };
  write(LOC_KEY, record);
  setCookie(record.token);
  window.dispatchEvent(new CustomEvent('laqi:location-change', { detail: record }));
  return record;
}

export function clearLocation() {
  try {
    localStorage.removeItem(LOC_KEY);
  } catch {
    /* ignore */
  }
  setCookie(null);
  window.dispatchEvent(new CustomEvent('laqi:location-change', { detail: null }));
}

export function getAlertSettings(): AlertSettings {
  return { ...DEFAULT_ALERTS, ...(read<Partial<AlertSettings>>(ALERT_KEY) ?? {}) };
}

/** The location alerts should watch: explicit alert location, else the saved location. */
export function alertLocation(settings = getAlertSettings()): { token: string; name: string } | null {
  if (settings.location) return settings.location;
  const saved = getSavedLocation();
  return saved ? { token: saved.token, name: saved.name } : null;
}

export function saveAlertSettings(s: AlertSettings) {
  write(ALERT_KEY, s);
  window.dispatchEvent(new CustomEvent('laqi:alerts-change', { detail: s }));
}

export interface LastSeen {
  token: string;
  standard: 'us' | 'in';
  aqi: number;
  level: number;
  /** Hour the reading is valid for (unix seconds). */
  time: number;
  state: import('../lib/aqi/alert-copy').AlertState;
}

export function getLastSeen(): LastSeen | null {
  return read<LastSeen>(SEEN_KEY);
}

export function setLastSeen(v: LastSeen) {
  write(SEEN_KEY, v);
}

// ---------------------------------------------------------------- summary API

export interface Summary {
  name: string;
  subtitle: string;
  href: string;
  cc: string;
  defaultStandard: 'us' | 'in';
  time: number;
  fetchedAt: number;
  readings: Record<'us' | 'in', { aqi: number; level: number; label: string; color: string; ink: string; dominant: string } | null>;
}

const summaryPromises = new Map<string, Promise<Summary | null>>();

/** One shared request per location per page view (header chip + in-page alerts). */
export function fetchSummary(token: string, force = false): Promise<Summary | null> {
  let p = summaryPromises.get(token);
  if (!p || force) {
    p = fetch(`/api/summary?loc=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Summary>) : null))
      .catch(() => null);
    summaryPromises.set(token, p);
  }
  return p;
}
