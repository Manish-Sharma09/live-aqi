/**
 * Health guidance per AQI category.
 *
 * Two kinds of content are kept strictly separate in the UI:
 *  - `official`: the health statement published by the standard's authority
 *    (US EPA / AirNow, or CPCB for India's NAQI).
 *  - `actions` and `tips`: general, practical guidance written by Live AQI.
 *    It is not medical advice and not an emergency advisory.
 */
import type { AqiCategory, PollutantId, StandardId } from './standards';

export type AdviceTone = 'ok' | 'caution' | 'warning' | 'danger';

export interface AdviceAction {
  id: 'outdoor' | 'sensitive' | 'mask' | 'windows' | 'purifier';
  label: string;
  value: string;
  detail: string;
  tone: AdviceTone;
}

export interface HealthAdvice {
  headline: string;
  official: { source: string; text: string };
  atRisk: string;
  actions: AdviceAction[];
  tips: string[];
  /** True when local authorities' advisories should be checked (levels 4–5). */
  checkLocalAdvisories: boolean;
}

const OFFICIAL: Record<StandardId, { source: string; texts: string[] }> = {
  us: {
    source: 'US EPA / AirNow',
    texts: [
      'Air quality is satisfactory, and air pollution poses little or no risk.',
      'Air quality is acceptable. However, there may be a risk for some people, particularly those who are unusually sensitive to air pollution.',
      'Members of sensitive groups may experience health effects. The general public is less likely to be affected.',
      'Some members of the general public may experience health effects; members of sensitive groups may experience more serious health effects.',
      'Health alert: The risk of health effects is increased for everyone.',
      'Health warning of emergency conditions: everyone is more likely to be affected.',
    ],
  },
  in: {
    source: 'CPCB National AQI',
    texts: [
      'Minimal impact.',
      'Minor breathing discomfort to sensitive people.',
      'Breathing discomfort to the people with lungs, asthma and heart diseases.',
      'Breathing discomfort to most people on prolonged exposure.',
      'Respiratory illness on prolonged exposure.',
      'Affects healthy people and seriously impacts those with existing diseases.',
    ],
  },
};

const HEADLINES = [
  'Air quality is good. Outdoor activities are safe for everyone.',
  'Air quality is acceptable. Unusually sensitive people should watch for symptoms.',
  'Sensitive groups should reduce prolonged or heavy outdoor exertion.',
  'Everyone should cut back on prolonged outdoor exertion today.',
  'Avoid prolonged outdoor exposure. Protect yourself indoors and out.',
  'Avoid all outdoor activity. Stay indoors with filtered air if you can.',
];

const AT_RISK =
  'People with heart or lung disease (including asthma), older adults, children and teenagers, pregnant people, and anyone who works or exercises outdoors.';

const GAS_POLLUTANTS: ReadonlySet<PollutantId> = new Set(['o3', 'no2', 'so2', 'co']);

function outdoor(level: number): AdviceAction {
  const v = [
    ['Enjoy outdoor activities', 'A good time to exercise, walk or ventilate.', 'ok'],
    ['Fine for most people', 'Unusually sensitive people should notice coughing or shortness of breath and ease off.', 'ok'],
    ['Reduce long or intense exercise', 'Take more breaks, do lighter activities, and keep inhalers handy if you have asthma.', 'caution'],
    ['Limit prolonged exertion', 'Shorten outdoor workouts and move intense exercise indoors.', 'warning'],
    ['Avoid prolonged exposure', 'Reschedule outdoor plans and keep trips outside short.', 'danger'],
    ['Avoid all outdoor activity', 'Stay indoors and keep physical activity levels low.', 'danger'],
  ][level]!;
  return { id: 'outdoor', label: 'Outdoor activity', value: v[0]!, detail: v[1]!, tone: v[2] as AdviceTone };
}

function sensitive(level: number): AdviceAction {
  const v = [
    ['No precautions needed', 'Normal activities for everyone.', 'ok'],
    ['Monitor symptoms', 'Consider reducing prolonged or heavy exertion if you feel symptoms.', 'caution'],
    ['Reduce exertion outdoors', 'Keep activities lighter and shorter; follow your asthma action plan.', 'warning'],
    ['Avoid prolonged exertion', 'Move activities indoors; watch for chest tightness, wheezing or palpitations.', 'danger'],
    ['Stay indoors', 'Keep activity levels low and have medication within reach.', 'danger'],
    ['Remain indoors', 'Keep activity levels low; seek medical help if symptoms worsen.', 'danger'],
  ][level]!;
  return { id: 'sensitive', label: 'Sensitive groups', value: v[0]!, detail: v[1]!, tone: v[2] as AdviceTone };
}

function mask(level: number, dominant: PollutantId): AdviceAction {
  if (GAS_POLLUTANTS.has(dominant) && level >= 2) {
    return {
      id: 'mask',
      label: 'Masks',
      value: 'Masks offer limited protection',
      detail: 'Particle respirators (N95/FFP2) do not filter gases such as ozone or NO₂. Limiting time and exertion outdoors is the main protection.',
      tone: level >= 4 ? 'danger' : 'warning',
    };
  }
  const v = [
    ['Not needed', 'Particle levels are low.', 'ok'],
    ['Not needed for most', 'Sensitive people may choose a respirator on busy roads.', 'ok'],
    ['Consider for sensitive groups', 'A well-fitting N95/FFP2 respirator helps on longer trips outside.', 'caution'],
    ['Recommended outdoors', 'Wear a well-fitting N95/FFP2 respirator for prolonged time outside.', 'warning'],
    ['Wear an N95/FFP2 outside', 'Fit matters more than brand — no gaps at the nose or cheeks. Cloth and surgical masks are not enough.', 'danger'],
    ['N95/FFP2 essential outside', 'Only go out if necessary, and wear a well-fitting respirator when you do.', 'danger'],
  ][level]!;
  return { id: 'mask', label: 'Masks', value: v[0]!, detail: v[1]!, tone: v[2] as AdviceTone };
}

function windows(level: number): AdviceAction {
  const v = [
    ['Open windows freely', 'Ventilate to refresh indoor air.', 'ok'],
    ['Ventilation is fine', 'Open windows as usual.', 'ok'],
    ['Ventilate selectively', 'Air out rooms when outdoor levels are lowest.', 'caution'],
    ['Keep windows closed', 'Ventilate briefly only when outdoor levels drop.', 'warning'],
    ['Keep windows closed', 'Close windows and doors when outdoor pollution is high.', 'danger'],
    ['Keep windows sealed', 'Close windows and doors, and block gaps where you can.', 'danger'],
  ][level]!;
  return { id: 'windows', label: 'Windows', value: v[0]!, detail: v[1]!, tone: v[2] as AdviceTone };
}

function purifier(level: number, dominant: PollutantId): AdviceAction {
  const gasNote = GAS_POLLUTANTS.has(dominant) ? ' HEPA filters remove particles, not gases.' : '';
  const v = [
    ['Not needed', 'Fresh outdoor air is a good source of ventilation.', 'ok'],
    ['Optional', 'Useful for sensitive people, especially in bedrooms.', 'ok'],
    ['Run if available', 'Use a HEPA purifier in rooms where sensitive people spend time.', 'caution'],
    ['Recommended', 'Run a HEPA purifier in the rooms you use most.', 'warning'],
    ['Run on high', 'Keep a HEPA purifier running and doors closed to create a cleaner room.', 'danger'],
    ['Run continuously', 'Create a clean room with a HEPA purifier and stay in it as much as possible.', 'danger'],
  ][level]!;
  return { id: 'purifier', label: 'Air purifier', value: v[0]!, detail: v[1]! + gasNote, tone: v[2] as AdviceTone };
}

const TIPS: string[][] = [
  ['Air out your home while outdoor air is clean.', 'A good day for outdoor exercise and errands.'],
  ['Unusually sensitive people may prefer quieter streets away from heavy traffic.', 'Check again later — conditions can change within hours.'],
  ['Plan strenuous activity for times when levels are lower.', 'Avoid exercising next to busy roads.', 'Keep reliever medication with you if you have asthma.'],
  ['Choose indoor exercise over outdoor workouts.', 'Avoid burning candles, incense or wood indoors — it adds to indoor particles.', 'Use recirculate mode for car ventilation in traffic.'],
  ['Postpone outdoor exercise and long commutes on foot or bike.', 'Avoid frying, smoking or burning anything indoors.', 'Check on older relatives and neighbours with heart or lung conditions.'],
  ['Stay indoors as much as possible and keep physical activity light.', 'Seek medical care for chest pain, severe breathlessness or palpitations.', 'Follow instructions from local health and civil authorities.'],
];

export function healthAdvice(standard: StandardId, category: AqiCategory, dominant: PollutantId): HealthAdvice {
  const level = category.level;
  const official = OFFICIAL[standard];
  return {
    headline: HEADLINES[level]!,
    official: { source: official.source, text: official.texts[level]! },
    atRisk: AT_RISK,
    actions: [outdoor(level), sensitive(level), mask(level, dominant), windows(level), purifier(level, dominant)],
    tips: TIPS[level]!,
    checkLocalAdvisories: level >= 4,
  };
}
