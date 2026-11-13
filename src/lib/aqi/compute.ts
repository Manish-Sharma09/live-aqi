/**
 * AQI computation from hourly pollutant concentrations.
 *
 * Input concentrations are µg/m³ for every pollutant (as delivered by the
 * Open-Meteo / CAMS data source). Each standard's averaging and unit rules are
 * applied here — see /methodology for the human-readable description.
 */
import {
  IN_POINTS,
  POLLUTANT_IDS,
  US_BREAKPOINTS,
  categoryFor,
  type AqiCategory,
  type PollutantId,
  type Segment,
  type StandardId,
} from './standards';

/** Hourly concentrations aligned with a shared time axis. µg/m³ for all pollutants. */
export type PollutantSeries = Record<PollutantId, ReadonlyArray<number | null>>;

export interface SubIndex {
  pollutant: PollutantId;
  index: number;
  /** Averaged concentration used for the index, in `unit`. */
  averaged: number;
  unit: 'µg/m³' | 'mg/m³';
  averaging: string;
}

export interface AqiResult {
  standard: StandardId;
  aqi: number;
  category: AqiCategory;
  dominant: PollutantId;
  subIndices: Partial<Record<PollutantId, SubIndex>>;
  /** The raw index exceeded the top of the scale (500); `aqi` is capped at 500. */
  beyondScale: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOLAR_VOLUME = 24.45; // L/mol at 25 °C, 1 atm (EPA reference conditions)
const MOLECULAR_WEIGHT = { o3: 48.0, no2: 46.0055, so2: 64.066, co: 28.01 } as const;

/** µg/m³ → ppb for a gas at 25 °C. */
export function ugm3ToPpb(ug: number, gas: keyof typeof MOLECULAR_WEIGHT): number {
  return (ug * MOLAR_VOLUME) / MOLECULAR_WEIGHT[gas];
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Truncate (not round) to `decimals`, as EPA requires before the AQI lookup. */
function trunc(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(v * f + 1e-9) / f;
}

/** Mean of the `len` hours ending at `end` (inclusive). Null if fewer than `minValid` valid hours. */
export function trailingMean(values: ReadonlyArray<number | null>, end: number, len: number, minValid: number): number | null {
  let sum = 0;
  let n = 0;
  for (let i = end - len + 1; i <= end; i++) {
    if (i < 0) continue;
    const v = values[i];
    if (isNum(v)) {
      sum += v;
      n++;
    }
  }
  return n >= minValid ? sum / n : null;
}

/**
 * EPA NowCast for particulate matter (12 hourly values, weight floor 0.5).
 * Valid only when at least 2 of the 3 most recent hours are present.
 */
export function nowCast(values: ReadonlyArray<number | null>, end: number): number | null {
  const c: Array<number | null> = [];
  for (let i = 0; i < 12; i++) {
    const v = end - i >= 0 ? values[end - i] : null;
    c.push(isNum(v) ? v : null);
  }
  const recentValid = c.slice(0, 3).filter((v) => v !== null).length;
  if (recentValid < 2) return null;
  const present = c.filter((v): v is number => v !== null);
  const max = Math.max(...present);
  const min = Math.min(...present);
  if (max <= 0) return 0;
  const w = Math.max(min / max, 0.5);
  let num = 0;
  let den = 0;
  c.forEach((v, i) => {
    if (v === null) return;
    const wi = w ** i;
    num += wi * v;
    den += wi;
  });
  return den > 0 ? num / den : null;
}

/** Maximum 8-hour trailing mean among the 24 hours ending at `end`. */
function max8hMeanIn24h(values: ReadonlyArray<number | null>, end: number): number | null {
  let best: number | null = null;
  for (let k = end - 23; k <= end; k++) {
    if (k < 7) continue;
    const m = trailingMean(values, k, 8, 6);
    if (m !== null && (best === null || m > best)) best = m;
  }
  return best;
}

function usIndexFrom(segments: readonly Segment[], c: number): number {
  for (const s of segments) {
    if (c >= s.cLo && c <= s.cHi) return ((s.iHi - s.iLo) / (s.cHi - s.cLo)) * (c - s.cLo) + s.iLo;
  }
  const last = segments[segments.length - 1]!;
  if (c > last.cHi) {
    // Beyond the top breakpoint: extend the highest segment (AirNow practice).
    return ((last.iHi - last.iLo) / (last.cHi - last.cLo)) * (c - last.cLo) + last.iLo;
  }
  // Inside a truncation gap (should not happen after truncation) — snap to the next segment.
  const next = segments.find((s) => c < s.cLo) ?? last;
  return next.iLo;
}

function inIndexFrom(points: ReadonlyArray<readonly [number, number]>, c: number): number {
  for (let i = 1; i < points.length; i++) {
    const [c0, i0] = points[i - 1]!;
    const [c1, i1] = points[i]!;
    if (c <= c1) return i0 + ((i1 - i0) / (c1 - c0)) * (c - c0);
  }
  const [cA, iA] = points[points.length - 2]!;
  const [cB, iB] = points[points.length - 1]!;
  const extrapolated = iB + ((iB - iA) / (cB - cA)) * (c - cB);
  return Math.min(extrapolated, 500);
}

// ---------------------------------------------------------------------------
// US EPA
// ---------------------------------------------------------------------------

function usSubIndices(s: PollutantSeries, t: number): Partial<Record<PollutantId, SubIndex>> {
  const out: Partial<Record<PollutantId, SubIndex>> = {};

  const pm25 = nowCast(s.pm25, t);
  if (pm25 !== null) {
    out.pm25 = { pollutant: 'pm25', index: usIndexFrom(US_BREAKPOINTS.pm25, trunc(pm25, 1)), averaged: pm25, unit: 'µg/m³', averaging: 'NowCast (12 h)' };
  }
  const pm10 = nowCast(s.pm10, t);
  if (pm10 !== null) {
    out.pm10 = { pollutant: 'pm10', index: usIndexFrom(US_BREAKPOINTS.pm10, trunc(pm10, 0)), averaged: pm10, unit: 'µg/m³', averaging: 'NowCast (12 h)' };
  }

  // Ozone: 8-hour index up to 0.200 ppm, and the 1-hour index from 0.125 ppm — report the higher.
  const o3_8 = trailingMean(s.o3, t, 8, 6);
  const o3_1 = isNum(s.o3[t]) ? s.o3[t]! : null;
  let o3Index: number | null = null;
  let o3Avg: number | null = null;
  let o3Label = '8-h mean';
  if (o3_8 !== null) {
    const ppm = trunc(ugm3ToPpb(o3_8, 'o3') / 1000, 3);
    if (ppm <= 0.2) {
      o3Index = usIndexFrom(US_BREAKPOINTS.o3_8h, ppm);
      o3Avg = o3_8;
    }
  }
  if (o3_1 !== null) {
    const ppm = trunc(ugm3ToPpb(o3_1, 'o3') / 1000, 3);
    if (ppm >= 0.125) {
      const idx = usIndexFrom(US_BREAKPOINTS.o3_1h, ppm);
      if (o3Index === null || idx > o3Index) {
        o3Index = idx;
        o3Avg = o3_1;
        o3Label = '1-h';
      }
    }
  }
  if (o3Index !== null && o3Avg !== null) {
    out.o3 = { pollutant: 'o3', index: o3Index, averaged: o3Avg, unit: 'µg/m³', averaging: o3Label };
  }

  const co8 = trailingMean(s.co, t, 8, 6);
  if (co8 !== null) {
    const ppm = trunc(ugm3ToPpb(co8, 'co') / 1000, 1);
    out.co = { pollutant: 'co', index: usIndexFrom(US_BREAKPOINTS.co, ppm), averaged: co8 / 1000, unit: 'mg/m³', averaging: '8-h mean' };
  }

  const so2_1 = isNum(s.so2[t]) ? s.so2[t]! : null;
  if (so2_1 !== null) {
    const ppb1 = trunc(ugm3ToPpb(so2_1, 'so2'), 0);
    if (ppb1 <= 304) {
      out.so2 = { pollutant: 'so2', index: usIndexFrom(US_BREAKPOINTS.so2_1h, ppb1), averaged: so2_1, unit: 'µg/m³', averaging: '1-h' };
    } else {
      const so2_24 = trailingMean(s.so2, t, 24, 18);
      const ppb24 = so2_24 !== null ? trunc(ugm3ToPpb(so2_24, 'so2'), 0) : null;
      const index = ppb24 !== null && ppb24 >= 305 ? usIndexFrom(US_BREAKPOINTS.so2_24h, ppb24) : 200;
      out.so2 = { pollutant: 'so2', index, averaged: so2_24 ?? so2_1, unit: 'µg/m³', averaging: so2_24 !== null ? '24-h mean' : '1-h' };
    }
  }

  const no2_1 = isNum(s.no2[t]) ? s.no2[t]! : null;
  if (no2_1 !== null) {
    out.no2 = { pollutant: 'no2', index: usIndexFrom(US_BREAKPOINTS.no2, trunc(ugm3ToPpb(no2_1, 'no2'), 0)), averaged: no2_1, unit: 'µg/m³', averaging: '1-h' };
  }
  return out;
}

// ---------------------------------------------------------------------------
// India NAQI (CPCB)
// ---------------------------------------------------------------------------

function inSubIndices(s: PollutantSeries, t: number): Partial<Record<PollutantId, SubIndex>> {
  const out: Partial<Record<PollutantId, SubIndex>> = {};
  for (const p of ['pm25', 'pm10', 'no2', 'so2'] as const) {
    // CPCB requires at least 16 hours of data for a 24-hour sub-index.
    const avg = trailingMean(s[p], t, 24, 16);
    if (avg !== null) out[p] = { pollutant: p, index: inIndexFrom(IN_POINTS[p], avg), averaged: avg, unit: 'µg/m³', averaging: '24-h mean' };
  }
  const o3 = max8hMeanIn24h(s.o3, t);
  if (o3 !== null) out.o3 = { pollutant: 'o3', index: inIndexFrom(IN_POINTS.o3, o3), averaged: o3, unit: 'µg/m³', averaging: 'max 8-h mean' };
  const co = max8hMeanIn24h(s.co, t);
  if (co !== null) {
    const mg = co / 1000;
    out.co = { pollutant: 'co', index: inIndexFrom(IN_POINTS.co, mg), averaged: mg, unit: 'mg/m³', averaging: 'max 8-h mean' };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ordering used to break ties when two sub-indices are equal. */
const TIE_ORDER: PollutantId[] = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'];

/**
 * Overall AQI at hour index `t`. Returns null when the data does not satisfy
 * the standard's sufficiency rules (CPCB: ≥ 3 pollutants incl. PM2.5 or PM10).
 */
export function computeAqi(standard: StandardId, series: PollutantSeries, t: number): AqiResult | null {
  const subs = standard === 'us' ? usSubIndices(series, t) : inSubIndices(series, t);
  const ids = TIE_ORDER.filter((p) => subs[p] !== undefined);
  if (ids.length === 0) return null;
  if (standard === 'in' && (ids.length < 3 || !(subs.pm25 || subs.pm10))) return null;
  if (standard === 'us' && !(subs.pm25 || subs.pm10 || subs.o3)) return null;

  // Pick the dominant pollutant on the raw (uncapped) sub-indices, then cap at
  // the top of the scale: values past 500 are reported as "500+ / beyond the index".
  let dominant = ids[0]!;
  for (const p of ids) if (subs[p]!.index > subs[dominant]!.index) dominant = p;
  const beyondScale = subs[dominant]!.index > 500;
  for (const p of ids) subs[p]!.index = Math.min(Math.round(subs[p]!.index), 500);
  const aqi = subs[dominant]!.index;
  return {
    standard,
    aqi,
    category: categoryFor(standard, aqi),
    dominant,
    subIndices: subs,
    beyondScale,
  };
}

/** Overall AQI for every hour in `[from, to]` (inclusive); null where data is insufficient. */
export function computeAqiSeries(standard: StandardId, series: PollutantSeries, from: number, to: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let t = from; t <= to; t++) out.push(computeAqi(standard, series, t)?.aqi ?? null);
  return out;
}

/** Index of the most recent hour at or before `nowSec` (unix seconds). -1 when none. */
export function currentHourIndex(times: ReadonlyArray<number>, nowSec: number): number {
  let idx = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i]! <= nowSec) idx = i;
    else break;
  }
  return idx;
}

/** Last valid concentration at or before `t` for each pollutant (µg/m³; CO in mg/m³). */
export function latestConcentrations(series: PollutantSeries, t: number): Partial<Record<PollutantId, number>> {
  const out: Partial<Record<PollutantId, number>> = {};
  for (const p of POLLUTANT_IDS) {
    const v = series[p][t];
    if (isNum(v)) out[p] = p === 'co' ? v / 1000 : v;
  }
  return out;
}
