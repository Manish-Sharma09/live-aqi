/** Formatting helpers shared by server-rendered components. */

export function formatHour(unixSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: safeTz(timeZone) }).format(
    unixSec * 1000,
  );
}

export function formatDateTime(unixSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: safeTz(timeZone),
  }).format(unixSec * 1000);
}

export function formatDay(unixSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: safeTz(timeZone) }).format(
    unixSec * 1000,
  );
}

export function tzAbbreviation(unixSec: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: safeTz(timeZone), timeZoneName: 'short' }).formatToParts(unixSec * 1000);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

export function safeTz(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function relativeTime(fromMs: number, nowMs = Date.now()): string {
  const s = Math.round((nowMs - fromMs) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function isoTime(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Sensible precision for a concentration value. */
export function formatConcentration(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 100) return formatNumber(v, 0);
  if (v >= 10) return formatNumber(v, 1);
  return formatNumber(v, 2);
}

export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '±0';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
}

export function compactPopulation(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

export function compassPoint(deg: number | null): string {
  if (deg === null) return '';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(deg / 45) % 8]!;
}

/** Country code → regional-indicator flag emoji. */
export function flag(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
