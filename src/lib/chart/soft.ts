/**
 * Soft line/area chart (shared by server first paint and the browser).
 * - Monotone cubic curves: smooth, but never overshoot real values.
 * - AQI mode colours the line by category with a hard-stop gradient keyed to
 *   the category boundaries, so colour changes exactly where the category does.
 * Every text value is escaped.
 */

export interface SoftSeries {
  values: Array<number | null>;
  /** CSS colour, or 'categories' to colour by AQI category thresholds. */
  color: string;
  label: string;
}

export interface SoftSpec {
  id: string;
  width: number;
  height: number;
  series: SoftSeries[];
  /** Category bands for 'categories' colouring: upper bound + colour, ascending. */
  bands?: Array<{ max: number; color: string }>;
  nowIndex: number;
  yMax: number;
  gridlines: number[];
  xTicks: Array<{ index: number; label: string }>;
  /** Indices that get a dot marker (the mockup marks every few hours). */
  dots?: number[];
  ariaLabel: string;
}

export const SOFT_PAD = { top: 16, right: 16, bottom: 30, left: 40 };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => (Math.round(n * 10) / 10).toString();

export function softGeometry(spec: Pick<SoftSpec, 'width' | 'height'> & { count: number }) {
  const plotW = Math.max(10, spec.width - SOFT_PAD.left - SOFT_PAD.right);
  const plotH = Math.max(10, spec.height - SOFT_PAD.top - SOFT_PAD.bottom);
  const step = spec.count > 1 ? plotW / (spec.count - 1) : plotW;
  return { plotW, plotH, step, x0: SOFT_PAD.left, y0: SOFT_PAD.top, base: SOFT_PAD.top + plotH };
}

/** Fritsch–Carlson monotone cubic path through points (one contiguous run). */
function monotonePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    m.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2);
  t.push(m[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i]!;
      t[i + 1] = k * b * m[i]!;
    }
  }
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${f(x0 + h)} ${f(y0 + h * t[i]!)} ${f(x1 - h)} ${f(y1 - h * t[i + 1]!)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

function runs(values: Array<number | null>, from: number, to: number, x: (i: number) => number, y: (v: number) => number) {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    cur.push([x(i), y(v)]);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function renderSoftChart(spec: SoftSpec): string {
  const count = spec.series[0]?.values.length ?? 0;
  const { plotW, plotH, step, x0, y0, base } = softGeometry({ ...spec, count });
  const x = (i: number) => x0 + step * i;
  const y = (v: number) => base - (Math.min(Math.max(v, 0), spec.yMax) / spec.yMax) * plotH;
  const parts: string[] = [];
  const gid = esc(spec.id);

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="100%" role="img" aria-label="${esc(spec.ariaLabel)}" style="display:block;height:auto;overflow:visible">`,
  );

  // Defs: category gradient (hard stops) + area fades.
  parts.push('<defs>');
  if (spec.bands?.length) {
    const stops: string[] = [];
    let lo = 0;
    for (const b of spec.bands) {
      const a = Math.min(lo / spec.yMax, 1);
      const z = Math.min(b.max / spec.yMax, 1);
      stops.push(`<stop offset="${a.toFixed(4)}" stop-color="${esc(b.color)}"/><stop offset="${z.toFixed(4)}" stop-color="${esc(b.color)}"/>`);
      lo = b.max;
      if (z >= 1) break;
    }
    parts.push(
      `<linearGradient id="${gid}-cat" gradientUnits="userSpaceOnUse" x1="0" y1="${f(base)}" x2="0" y2="${f(y0)}">${stops.join('')}</linearGradient>`,
    );
  }
  spec.series.forEach((s, k) => {
    const c = s.color === 'categories' ? `url(#${gid}-cat)` : esc(s.color);
    if (s.color === 'categories') {
      parts.push(
        `<linearGradient id="${gid}-fade${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${gid}-mask${k}"><rect x="0" y="0" width="${spec.width}" height="${spec.height}" fill="url(#${gid}-fade${k})"/></mask>`,
      );
    } else {
      parts.push(
        `<linearGradient id="${gid}-fade${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`,
      );
    }
  });
  parts.push('</defs>');

  // Grid
  parts.push('<g font-size="11" fill="var(--ink-3)">');
  for (const g of [0, ...spec.gridlines]) {
    if (g > spec.yMax) continue;
    const gy = y(g);
    parts.push(`<line x1="${x0}" x2="${f(x0 + plotW)}" y1="${f(gy)}" y2="${f(gy)}" stroke="var(--line)" stroke-width="1"/>`);
    parts.push(`<text x="${x0 - 10}" y="${f(gy + 4)}" text-anchor="end">${g}</text>`);
  }
  for (const t of spec.xTicks) {
    parts.push(`<text x="${f(x(t.index))}" y="${f(base + 20)}" text-anchor="middle">${esc(t.label)}</text>`);
  }
  parts.push('</g>');

  // Forecast tint
  if (spec.nowIndex >= 0 && spec.nowIndex < count - 1) {
    const fx = x(spec.nowIndex);
    parts.push(`<rect x="${f(fx)}" y="${y0}" width="${f(x0 + plotW - fx)}" height="${f(plotH)}" fill="var(--surface-2)" opacity="0.7" rx="6"/>`);
    parts.push(`<text x="${f(x0 + plotW - 6)}" y="${y0 + 14}" text-anchor="end" font-size="10.5" font-weight="650" fill="var(--ink-3)">Forecast</text>`);
  }

  // Series
  spec.series.forEach((s, k) => {
    const stroke = s.color === 'categories' ? `url(#${gid}-cat)` : esc(s.color);
    const observed = runs(s.values, 0, Math.min(spec.nowIndex, count - 1), x, y);
    const forecast = spec.nowIndex < count - 1 ? runs(s.values, spec.nowIndex, count - 1, x, y) : [];
    for (const run of observed) {
      if (run.length > 1) {
        const area = `${monotonePath(run)}L${f(run[run.length - 1]![0])} ${f(base)}L${f(run[0]![0])} ${f(base)}Z`;
        if (s.color === 'categories') {
          parts.push(`<path d="${area}" fill="${stroke}" opacity="0.22" mask="url(#${gid}-mask${k})"/>`);
        } else {
          parts.push(`<path d="${area}" fill="url(#${gid}-fade${k})"/>`);
        }
      }
      parts.push(`<path d="${monotonePath(run)}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    for (const run of forecast) {
      parts.push(
        `<path d="${monotonePath(run)}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="5 5" opacity="0.7"/>`,
      );
    }
    for (const i of spec.dots ?? []) {
      const v = s.values[i];
      if (v === null || v === undefined) continue;
      parts.push(`<circle cx="${f(x(i))}" cy="${f(y(v))}" r="3.6" fill="var(--surface)" stroke="${stroke}" stroke-width="2"/>`);
    }
    const nv = s.values[spec.nowIndex];
    if (nv !== null && nv !== undefined) {
      parts.push(`<circle cx="${f(x(spec.nowIndex))}" cy="${f(y(nv))}" r="5.5" fill="${stroke}" stroke="var(--surface)" stroke-width="2.5"/>`);
    }
  });

  parts.push(`<line data-crosshair x1="0" x2="0" y1="${y0}" y2="${f(base)}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`);
  parts.push('</svg>');
  return parts.join('');
}
