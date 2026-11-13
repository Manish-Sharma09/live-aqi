/**
 * AQI standards supported by Live AQI.
 *
 * - US EPA AQI — 40 CFR Part 58 Appendix G, incl. the PM2.5 breakpoint revision
 *   effective 6 May 2024. Real-time PM uses the EPA NowCast.
 * - India National AQI (NAQI) — Central Pollution Control Board (CPCB), 2014.
 *
 * Breakpoints are expressed in the units each standard defines. Conversions from
 * the µg/m³ values delivered by the data source happen in `compute.ts`.
 */

export type StandardId = 'us' | 'in';
export type PollutantId = 'pm25' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co';

export const POLLUTANT_IDS: readonly PollutantId[] = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'];

export type CategoryFace = 'happy' | 'smile' | 'neutral' | 'frown' | 'sad' | 'mask';

export interface AqiCategory {
  /** 0 (best) … 5 (worst). Comparable across standards as a severity rank only. */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  key: string;
  label: string;
  /** One-line plain-language summary shown under the reading. */
  short: string;
  /** Index range covered by the category (inclusive). */
  min: number;
  max: number;
  /** Category fill for bars, pills, markers and charts (data marks only). */
  color: string;
  /** Text colour that is legible on top of `color`. */
  ink: string;
  /** Colour for large numerals on the day (light) and night (dark) glass card. */
  text: { light: string; dark: string };
  face: CategoryFace;
}

export interface StandardDefinition {
  id: StandardId;
  name: string;
  shortName: string;
  authority: string;
  /** Upper end of the scale used for gauges (values can exceed it for US AQI). */
  scaleMax: number;
  categories: readonly AqiCategory[];
}

export const US_EPA: StandardDefinition = {
  id: 'us',
  name: 'US EPA Air Quality Index',
  shortName: 'US AQI',
  authority: 'U.S. Environmental Protection Agency',
  scaleMax: 500,
  categories: [
    { level: 0, key: 'good', label: 'Good', short: 'Little to no health risk', min: 0, max: 50, color: '#4CC27A', ink: '#0F2A19', text: { light: '#1D7F45', dark: '#6BE39A' }, face: 'happy' },
    { level: 1, key: 'moderate', label: 'Moderate', short: 'Fine for most; sensitive people take it easy', min: 51, max: 100, color: '#F2C94C', ink: '#3A2C00', text: { light: '#9A6F00', dark: '#F6D569' }, face: 'smile' },
    { level: 2, key: 'usg', label: 'Unhealthy for Sensitive Groups', short: 'Sensitive groups should limit time outdoors', min: 101, max: 150, color: '#F2994A', ink: '#3D1D00', text: { light: '#B85309', dark: '#F9AE6B' }, face: 'neutral' },
    { level: 3, key: 'unhealthy', label: 'Unhealthy', short: 'Everyone should cut back on outdoor exertion', min: 151, max: 200, color: '#EB5757', ink: '#2D0B0B', text: { light: '#C42B2B', dark: '#F47F7F' }, face: 'frown' },
    { level: 4, key: 'very-unhealthy', label: 'Very Unhealthy', short: 'Health alert: avoid long outdoor activity', min: 201, max: 300, color: '#A66CD9', ink: '#1F0B33', text: { light: '#7A3DB0', dark: '#C9A0F2' }, face: 'sad' },
    { level: 5, key: 'hazardous', label: 'Hazardous', short: 'Emergency conditions: stay indoors', min: 301, max: Infinity, color: '#9B2C4A', ink: '#FFFFFF', text: { light: '#8E1D3D', dark: '#F2879F' }, face: 'mask' },
  ],
};

export const IN_NAQI: StandardDefinition = {
  id: 'in',
  name: 'India National Air Quality Index',
  shortName: 'India NAQI',
  authority: 'Central Pollution Control Board (CPCB)',
  scaleMax: 500,
  categories: [
    { level: 0, key: 'good', label: 'Good', short: 'Minimal impact on health', min: 0, max: 50, color: '#3BAA62', ink: '#06210F', text: { light: '#17763C', dark: '#5FD48A' }, face: 'happy' },
    { level: 1, key: 'satisfactory', label: 'Satisfactory', short: 'Minor discomfort for sensitive people', min: 51, max: 100, color: '#9BD25C', ink: '#1C2E06', text: { light: '#4F7E14', dark: '#B5E37E' }, face: 'smile' },
    { level: 2, key: 'moderate', label: 'Moderate', short: 'Sensitive groups may feel breathing discomfort', min: 101, max: 200, color: '#F2C94C', ink: '#3A2C00', text: { light: '#9A6F00', dark: '#F6D569' }, face: 'neutral' },
    { level: 3, key: 'poor', label: 'Poor', short: 'Breathing discomfort for most on long exposure', min: 201, max: 300, color: '#F2994A', ink: '#3D1D00', text: { light: '#B85309', dark: '#F9AE6B' }, face: 'frown' },
    { level: 4, key: 'very-poor', label: 'Very Poor', short: 'Avoid long outdoor exposure', min: 301, max: 400, color: '#EB5757', ink: '#2D0B0B', text: { light: '#C42B2B', dark: '#F47F7F' }, face: 'sad' },
    { level: 5, key: 'severe', label: 'Severe', short: 'Serious risk even for healthy people: stay indoors', min: 401, max: Infinity, color: '#9B2C4A', ink: '#FFFFFF', text: { light: '#8E1D3D', dark: '#F2879F' }, face: 'mask' },
  ],
};

export const STANDARDS: Record<StandardId, StandardDefinition> = { us: US_EPA, in: IN_NAQI };

export function isStandardId(v: unknown): v is StandardId {
  return v === 'us' || v === 'in';
}

/** India uses its national index by default; everywhere else defaults to US EPA. */
export function defaultStandardFor(countryCode: string | undefined): StandardId {
  return countryCode?.toUpperCase() === 'IN' ? 'in' : 'us';
}

export function categoryFor(standard: StandardId, aqi: number): AqiCategory {
  const cats = STANDARDS[standard].categories;
  const v = Math.max(0, Math.round(aqi));
  for (const c of cats) if (v <= c.max) return c;
  return cats[cats.length - 1]!;
}

export function categoryByLevel(standard: StandardId, level: number): AqiCategory {
  const cats = STANDARDS[standard].categories;
  return cats[Math.min(Math.max(level, 0), cats.length - 1)]!;
}

// ---------------------------------------------------------------------------
// US EPA breakpoints (discrete, applied after truncation)
// ---------------------------------------------------------------------------

export interface Segment {
  cLo: number;
  cHi: number;
  iLo: number;
  iHi: number;
}

const seg = (cLo: number, cHi: number, iLo: number, iHi: number): Segment => ({ cLo, cHi, iLo, iHi });

export const US_BREAKPOINTS = {
  /** µg/m³, 24-hour (NowCast for real-time) — 2024 revision. */
  pm25: [
    seg(0.0, 9.0, 0, 50),
    seg(9.1, 35.4, 51, 100),
    seg(35.5, 55.4, 101, 150),
    seg(55.5, 125.4, 151, 200),
    seg(125.5, 225.4, 201, 300),
    seg(225.5, 325.4, 301, 500),
  ],
  /** µg/m³, 24-hour (NowCast for real-time). */
  pm10: [
    seg(0, 54, 0, 50),
    seg(55, 154, 51, 100),
    seg(155, 254, 101, 150),
    seg(255, 354, 151, 200),
    seg(355, 424, 201, 300),
    seg(425, 604, 301, 500),
  ],
  /** ppm, 8-hour. Not defined above 0.200 ppm (use the 1-hour table). */
  o3_8h: [
    seg(0.0, 0.054, 0, 50),
    seg(0.055, 0.07, 51, 100),
    seg(0.071, 0.085, 101, 150),
    seg(0.086, 0.105, 151, 200),
    seg(0.106, 0.2, 201, 300),
  ],
  /** ppm, 1-hour. Only defined from 0.125 ppm. */
  o3_1h: [
    seg(0.125, 0.164, 101, 150),
    seg(0.165, 0.204, 151, 200),
    seg(0.205, 0.404, 201, 300),
    seg(0.405, 0.604, 301, 500),
  ],
  /** ppm, 8-hour. */
  co: [
    seg(0.0, 4.4, 0, 50),
    seg(4.5, 9.4, 51, 100),
    seg(9.5, 12.4, 101, 150),
    seg(12.5, 15.4, 151, 200),
    seg(15.5, 30.4, 201, 300),
    seg(30.5, 50.4, 301, 500),
  ],
  /** ppb, 1-hour — only used up to 304 ppb (AQI 200). */
  so2_1h: [seg(0, 35, 0, 50), seg(36, 75, 51, 100), seg(76, 185, 101, 150), seg(186, 304, 151, 200)],
  /** ppb, 24-hour — used for AQI above 200. */
  so2_24h: [seg(305, 604, 201, 300), seg(605, 1004, 301, 500)],
  /** ppb, 1-hour. */
  no2: [
    seg(0, 53, 0, 50),
    seg(54, 100, 51, 100),
    seg(101, 360, 101, 150),
    seg(361, 649, 151, 200),
    seg(650, 1249, 201, 300),
    seg(1250, 2049, 301, 500),
  ],
} as const satisfies Record<string, readonly Segment[]>;

// ---------------------------------------------------------------------------
// India NAQI breakpoints — continuous piecewise-linear points (concentration, index)
// Units: µg/m³ except CO (mg/m³). Averaging: 24 h, except O3 and CO (8 h).
// Above the top breakpoint, the sub-index is extrapolated along the "Very Poor"
// segment slope and capped at 500 (the top of the NAQI scale).
// ---------------------------------------------------------------------------

export const IN_POINTS: Record<PollutantId, ReadonlyArray<readonly [number, number]>> = {
  pm10: [[0, 0], [50, 50], [100, 100], [250, 200], [350, 300], [430, 400]],
  pm25: [[0, 0], [30, 50], [60, 100], [90, 200], [120, 300], [250, 400]],
  no2: [[0, 0], [40, 50], [80, 100], [180, 200], [280, 300], [400, 400]],
  o3: [[0, 0], [50, 50], [100, 100], [168, 200], [208, 300], [748, 400]],
  co: [[0, 0], [1, 50], [2, 100], [10, 200], [17, 300], [34, 400]],
  so2: [[0, 0], [40, 50], [80, 100], [380, 200], [800, 300], [1600, 400]],
};
