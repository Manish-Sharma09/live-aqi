/**
 * Maps a location's hourly trend data onto a SoftSpec for a given range and
 * metric. Pure — used by the server for first paint and by the browser.
 */
import { categoryFor, STANDARDS, type StandardId } from '../aqi/standards';
import type { SoftSpec } from './soft';

export type TrendRange = '24h' | '7d' | 'forecast';
export type TrendMetric = 'aqi' | 'pm';

export interface TrendPayload {
  times: number[];
  nowIndex: number;
  us: Array<number | null>;
  in: Array<number | null>;
  pm25: Array<number | null>;
  pm10: Array<number | null>;
  timezone: string;
  standard: StandardId;
}

export interface TrendRow {
  time: number;
  aqi: number | null;
  category: string | null;
  color: string | null;
  pm25: number | null;
  pm10: number | null;
  forecast: boolean;
}

const WHO_24H = { pm25: 15, pm10: 45 } as const;

/** Smallest "nice" number ≥ v from the 1–2–2.5–5 × 10ⁿ sequence. */
export function niceCeil(v: number): number {
  if (v <= 0) return 10;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}
const BOUNDARIES: Record<StandardId, number[]> = {
  us: [50, 100, 150, 200, 300, 500],
  in: [50, 100, 200, 300, 400, 500],
};

/**
 * Y-axis top for an AQI chart: the first category boundary above the peak plus 15%
 * headroom. Peaks near the top of the scale stop at 500 (the index is capped there)
 * instead of jumping to 1000 and squashing the line into the lower half.
 */
export function aqiAxisMax(standard: StandardId, peak: number): number {
  const target = peak * 1.15;
  return Math.max(100, BOUNDARIES[standard].find((x) => x >= target) ?? (peak <= 500 ? 500 : niceCeil(target)));
}

export const RANGE_LABEL: Record<TrendRange, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  forecast: 'next 48 hours (forecast)',
};

export function sliceFor(p: TrendPayload, range: TrendRange): { from: number; to: number; now: number } {
  const n = p.times.length;
  if (range === 'forecast') {
    const from = p.nowIndex;
    return { from, to: Math.min(n - 1, p.nowIndex + 48), now: 0 };
  }
  const hours = range === '24h' ? 24 : 168;
  const from = Math.max(0, p.nowIndex - hours + 1);
  return { from, to: p.nowIndex, now: p.nowIndex - from };
}

export function rowsFor(p: TrendPayload, range: TrendRange): TrendRow[] {
  const { from, to } = sliceFor(p, range);
  const values = p[p.standard];
  const rows: TrendRow[] = [];
  for (let i = from; i <= to; i++) {
    const v = values[i] ?? null;
    const cat = v === null ? null : categoryFor(p.standard, v);
    rows.push({
      time: p.times[i]!,
      aqi: v,
      category: cat?.label ?? null,
      color: cat?.color ?? null,
      pm25: p.pm25[i] ?? null,
      pm10: p.pm10[i] ?? null,
      forecast: i > p.nowIndex,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Soft chart (redesign): smooth category-coloured line, 12-hour axis labels.
// ---------------------------------------------------------------------------

function hour12Parts(timezone: string) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: true, weekday: 'short' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', hour12: true, weekday: 'short' });
  }
  return (t: number) => {
    const parts = fmt.formatToParts(t * 1000);
    const get = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
    const h12 = Number(get('hour'));
    const period = get('dayPeriod').toUpperCase();
    const hour24 = (h12 % 12) + (period === 'PM' ? 12 : 0);
    return { hour24, label: `${h12} ${period}`, weekday: get('weekday') };
  };
}

export function buildSoftTrendSpec(
  p: TrendPayload,
  range: TrendRange,
  metric: TrendMetric,
  width: number,
  height: number,
  id = 'trend',
): SoftSpec {
  const { from, to, now } = sliceFor(p, range);
  const pick = (arr: Array<number | null>) => arr.slice(from, to + 1).map((v) => (v === null || v === undefined ? null : v));
  const aqi = pick(p[p.standard]);
  const pm25 = pick(p.pm25);
  const pm10 = pick(p.pm10);
  const times = p.times.slice(from, to + 1);
  const narrow = width < 520;

  let yMax: number;
  if (metric === 'aqi') {
    const present = aqi.filter((v): v is number => v !== null);
    yMax = aqiAxisMax(p.standard, present.length ? Math.max(...present) : 0);
  } else {
    const all = [...pm25, ...pm10].filter((v): v is number => v !== null);
    yMax = niceCeil(Math.max(all.length ? Math.max(...all) : 0, WHO_24H.pm10) * 1.15);
  }
  const q = yMax / 4;
  const gridlines = [1, 2, 3, 4].map((k) => Math.round(q * k));

  const parts = hour12Parts(p.timezone);
  const xTicks: SoftSpec['xTicks'] = [];
  const dots: number[] = [];
  times.forEach((t, i) => {
    const { hour24, label, weekday } = parts(t);
    if (range === '7d') {
      if (hour24 === 0 && i > 0) xTicks.push({ index: i, label: narrow ? weekday.slice(0, 2) : weekday });
    } else if (range === '24h') {
      if (hour24 % (narrow ? 6 : 3) === 0) {
        xTicks.push({ index: i, label });
        dots.push(i);
      }
    } else if (hour24 % (narrow ? 12 : 6) === 0) {
      xTicks.push({ index: i, label: hour24 === 0 ? weekday : label });
      dots.push(i);
    }
  });

  const bands = STANDARDS[p.standard].categories.map((c) => ({ max: c.max === Infinity ? 1e6 : c.max, color: c.color }));
  const nowValue = metric === 'aqi' ? aqi[now] : pm25[now];
  const label =
    metric === 'aqi'
      ? `${STANDARDS[p.standard].shortName}, hourly, ${RANGE_LABEL[range]}.${nowValue !== null && nowValue !== undefined ? ` Now ${nowValue} (${categoryFor(p.standard, nowValue).label}).` : ''}`
      : `PM2.5 and PM10 in µg/m³, hourly, ${RANGE_LABEL[range]}.`;

  return {
    id,
    width,
    height,
    series:
      metric === 'aqi'
        ? [{ values: aqi, color: 'categories', label: STANDARDS[p.standard].shortName }]
        : [
            { values: pm25, color: 'var(--series-pm25)', label: 'PM2.5' },
            { values: pm10, color: 'var(--series-pm10)', label: 'PM10' },
          ],
    bands,
    nowIndex: now,
    yMax,
    gridlines,
    xTicks,
    dots,
    ariaLabel: label,
  };
}
