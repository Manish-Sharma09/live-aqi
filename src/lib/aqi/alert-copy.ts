/**
 * Alert wording shared by in-page alerts (browser) and Web Push (server).
 * Pure module — safe to import from client scripts.
 */

export const ALERT_ACTIONS = [
  'Air quality is good.',
  'Unusually sensitive people should watch for symptoms.',
  'Sensitive groups should reduce prolonged or heavy outdoor exertion.',
  'Reduce prolonged outdoor activity. Sensitive groups should consider a well-fitting mask.',
  'Avoid prolonged outdoor exposure. Wear a well-fitting N95 outside and keep windows closed.',
  'Avoid all outdoor activity. Stay indoors with filtered air if you can, and follow local advisories.',
] as const;

/** Category names per standard, by level — used to describe thresholds. */
export const LEVEL_LABELS = {
  us: ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'],
  in: ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'],
} as const;

export const STANDARD_SHORT = { us: 'US AQI', in: 'India NAQI' } as const;

export type AlertKind = 'worse' | 'severe' | 'improved' | 'test';

export interface AlertMessage {
  kind: AlertKind;
  title: string;
  body: string;
  level: number;
}

export function composeAlert(
  kind: AlertKind,
  place: string,
  standard: 'us' | 'in',
  aqi: number,
  level: number,
): AlertMessage {
  const label = LEVEL_LABELS[standard][level] ?? '';
  const reading = `${STANDARD_SHORT[standard]} ${aqi} — ${label}.`;
  switch (kind) {
    case 'severe':
      return { kind, level, title: `Severe pollution in ${place}`, body: `${reading} ${ALERT_ACTIONS[level]}` };
    case 'improved':
      return { kind, level, title: `Air quality improved in ${place}`, body: `${reading} Conditions are back below your alert level.` };
    case 'test':
      return { kind, level, title: `Live AQI alerts are on for ${place}`, body: `Current reading: ${reading} You'll be notified when it crosses your threshold.` };
    default:
      return { kind, level, title: `Air quality worsened in ${place}`, body: `${reading} ${ALERT_ACTIONS[level]}` };
  }
}

export interface AlertState {
  /** Highest level already alerted since the reading last recovered. -1 when re-armed. */
  alertedLevel: number;
  /** Whether the reading is (or was last) at or above the trigger line. */
  above: boolean;
  /** Data time (unix s) of the first reading below the line while `above`. */
  belowSince: number | null;
}

/** Threshold value meaning "no threshold alerts — severe alerts only". */
export const SEVERE_ONLY = 6;

/**
 * Decide whether a reading warrants an alert. Pure, deterministic and
 * idempotent (re-evaluating the same data hour never changes the outcome), so
 * the browser and the push sweep share exactly the same de-duplication rules:
 *  - alert once when the trigger line is first reached, then again only if the
 *    category escalates further (e.g. Poor → Very Poor → Severe);
 *  - with severe alerts on, the worst category always triggers (high priority);
 *  - recovery must persist across at least two hourly readings before an
 *    "improved" alert, so a value hovering at a category boundary stays quiet.
 */
export function evaluateAlert(
  prev: AlertState | null,
  level: number,
  time: number,
  threshold: number,
  opts: { severe: boolean; improve: boolean },
): { kind: AlertKind | null; next: AlertState } {
  const s: AlertState = prev ?? { alertedLevel: -1, above: false, belowSince: null };
  const triggered = level >= threshold || (opts.severe && level >= 5);
  if (triggered) {
    if (level > s.alertedLevel) {
      const kind: AlertKind = level >= 5 && opts.severe ? 'severe' : 'worse';
      return { kind, next: { alertedLevel: level, above: true, belowSince: null } };
    }
    return { kind: null, next: { alertedLevel: s.alertedLevel, above: true, belowSince: null } };
  }
  if (s.above) {
    const since = s.belowSince ?? time;
    if (time - since >= 3600) {
      return { kind: opts.improve ? 'improved' : null, next: { alertedLevel: -1, above: false, belowSince: null } };
    }
    return { kind: null, next: { ...s, belowSince: since } };
  }
  return { kind: null, next: { alertedLevel: -1, above: false, belowSince: null } };
}

/** Initial state for a new subscriber/visitor: never alert for conditions that already exist. */
export function baselineState(level: number, threshold: number, opts: { severe: boolean }): AlertState {
  const triggered = level >= threshold || (opts.severe && level >= 5);
  return triggered ? { alertedLevel: level, above: true, belowSince: null } : { alertedLevel: -1, above: false, belowSince: null };
}
