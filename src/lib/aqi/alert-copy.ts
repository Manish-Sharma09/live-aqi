/**
 * Alert wording shared by in-page alerts (browser) and Web Push (server).
 * Pure module — safe to import from client scripts.
 */

/** Icon for one alert step (drawn by Icon.astro in the in-page alert). */
export type AlertStepIcon = 'mask' | 'window' | 'home' | 'fan' | 'wind' | 'heart' | 'sun';

export interface AlertStep {
  icon: AlertStepIcon;
  text: string;
}

/** What to do, said plainly: one headline and a few steps. */
export interface AlertAdvice {
  /** Leads the push title, which can't carry an icon of its own. */
  emoji: string;
  headline: string;
  steps: AlertStep[];
}

/**
 * Per category level, matching the health panel (health.ts): the action that
 * matters most first. Steps are short enough for a notification line.
 */
const ADVICE: AlertAdvice[] = [
  {
    emoji: '🌿',
    headline: 'Breathe easy',
    steps: [
      { icon: 'wind', text: 'Open the windows and let fresh air in' },
      { icon: 'sun', text: 'A great time to be outside' },
    ],
  },
  {
    emoji: '🙂',
    headline: 'Air is okay',
    steps: [
      { icon: 'sun', text: 'Fine for most outdoor plans' },
      { icon: 'heart', text: 'Sensitive? Ease off if you cough or feel short of breath' },
    ],
  },
  {
    emoji: '⚠️',
    headline: 'Take it easy outside',
    steps: [
      { icon: 'sun', text: 'Keep outdoor workouts shorter and lighter' },
      { icon: 'heart', text: 'Asthma? Keep your inhaler handy' },
      { icon: 'mask', text: 'Sensitive people: N95 mask on busy roads' },
    ],
  },
  {
    emoji: '😷',
    headline: 'Wear a mask outside',
    steps: [
      { icon: 'mask', text: 'Wear an N95 / FFP2 mask outdoors' },
      { icon: 'window', text: 'Keep windows closed' },
      { icon: 'home', text: 'Move exercise indoors' },
    ],
  },
  {
    emoji: '😷',
    headline: 'Mask on, windows shut',
    steps: [
      { icon: 'mask', text: 'N95 / FFP2 mask whenever you go out' },
      { icon: 'window', text: 'Keep windows and doors closed' },
      { icon: 'fan', text: 'Run an air purifier if you have one' },
      { icon: 'home', text: 'Keep time outside short' },
    ],
  },
  {
    emoji: '🚨',
    headline: 'Stay indoors',
    steps: [
      { icon: 'home', text: 'Stay inside — go out only if you must' },
      { icon: 'mask', text: 'N95 / FFP2 mask essential outside' },
      { icon: 'window', text: 'Seal windows; air purifier on high' },
      { icon: 'heart', text: 'Chest pain or breathlessness? Get medical help' },
    ],
  },
];

const GASES = new Set(['o3', 'no2', 'so2', 'co']);

/**
 * Masks filter particles, not gases (O₃, NO₂, SO₂, CO): when a gas drives the
 * index, limiting time outside is the advice instead, as in the health panel.
 */
const GAS_MASK_STEP: AlertStep = { icon: 'home', text: 'Limit time outside — masks don’t filter gases like ozone' };
const GAS_HEADLINES: Partial<Record<number, string>> = { 3: 'Limit time outside', 4: 'Stay in, windows shut' };

/** Headline and steps for a category level, adjusted when the main pollutant is a gas. */
export function alertAdvice(level: number, dominant?: string | null): AlertAdvice {
  const base = ADVICE[Math.min(Math.max(level, 0), ADVICE.length - 1)]!;
  if (!dominant || !GASES.has(dominant) || level < 2) return base;
  const steps = base.steps.filter((s) => s.icon !== 'mask');
  return {
    emoji: level >= 5 ? base.emoji : '⚠️',
    headline: GAS_HEADLINES[level] ?? base.headline,
    steps: [GAS_MASK_STEP, ...steps].slice(0, base.steps.length),
  };
}

/** Category names per standard, by level — used to describe thresholds. */
export const LEVEL_LABELS = {
  us: ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'],
  in: ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'],
} as const;

export const STANDARD_SHORT = { us: 'US AQI', in: 'India NAQI' } as const;

export type AlertKind = 'worse' | 'severe' | 'improved' | 'test';

export interface AlertMessage extends AlertAdvice {
  kind: AlertKind;
  level: number;
  /** Push notification title: the headline first ("😷 Wear a mask outside · Delhi"). */
  title: string;
  /** Push notification body: the reading, then the steps as "• " lines. */
  body: string;
  /** The reading in words, e.g. "Air turned Unhealthy · US AQI 156". */
  reading: string;
}

/** Steps shown in a push body: the platforms show a few lines before truncating. */
const PUSH_STEPS = 3;

export function composeAlert(
  kind: AlertKind,
  place: string,
  standard: 'us' | 'in',
  aqi: number,
  level: number,
  /** Main pollutant id (e.g. 'pm25', 'o3'); picks gas-appropriate advice. */
  dominant?: string | null,
): AlertMessage {
  const label = LEVEL_LABELS[standard][level] ?? '';
  const value = `${STANDARD_SHORT[standard]} ${aqi}`;
  let advice = alertAdvice(level, dominant);
  let reading: string;
  let title: string;
  switch (kind) {
    case 'severe':
      reading = `Severe pollution: ${label} · ${value}`;
      title = `${advice.emoji} ${advice.headline} · ${place}`;
      break;
    case 'improved':
      // Recovered below the alert level: lead with the relief, then what's fine again.
      if (level <= 1) advice = { ...advice, emoji: '🌿', headline: 'Breathe easier' };
      else advice = { ...advice, emoji: '🌤️', headline: 'Air is improving' };
      reading = `Now ${label} · ${value}`;
      title = `${advice.emoji} ${advice.headline} · ${place}`;
      break;
    case 'test':
      reading = `Right now: ${label} · ${value}`;
      title = `🔔 Live AQI alerts are on for ${place}`;
      break;
    default:
      reading = `Air turned ${label} · ${value}`;
      title = `${advice.emoji} ${advice.headline} · ${place}`;
  }
  const lead = kind === 'test' ? `${reading}. ${advice.emoji} ${advice.headline}:` : `${reading}.`;
  const body = [lead, ...advice.steps.slice(0, PUSH_STEPS).map((s) => `• ${s.text}`)].join('\n');
  return { kind, level, title, body, reading, ...advice };
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
