/**
 * The Live AQI alert chime, synthesised with Web Audio (no audio file to load):
 * a soft "breath" (filtered noise swelling in and out) followed by bell tones —
 *   worse     two falling notes          E5 → C5
 *   severe    an urgent four-note call   A5 E5 A5 E5, with no breath first
 *   improved  three rising notes         C5 → E5 → G5
 *   test      the signature              C5 → G5
 *
 * Browsers only let a page make sound after the visitor has interacted with it,
 * so `primeAlertSound()` unlocks audio on the first tap / click / key press.
 * Web Push notifications can't carry a custom sound: the device plays its own;
 * this chime plays when an alert arrives while a Live AQI page is open.
 */
import type { AlertKind } from '../lib/aqi/alert-copy';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/** Unlock audio on the visitor's first interaction, so a later alert can sound. */
export function primeAlertSound() {
  const unlock = () => {
    const c = audio();
    if (c?.state === 'suspended') c.resume().catch(() => {});
    for (const t of ['pointerdown', 'keydown', 'touchend'] as const) removeEventListener(t, unlock, true);
  };
  for (const t of ['pointerdown', 'keydown', 'touchend'] as const) addEventListener(t, unlock, { capture: true, passive: true });
}

const NOTES: Record<AlertKind, { freqs: number[]; gap: number; breath: boolean; wave: OscillatorType }> = {
  worse: { freqs: [659.25, 523.25], gap: 0.2, breath: true, wave: 'sine' },
  severe: { freqs: [880, 659.25, 880, 659.25], gap: 0.15, breath: false, wave: 'triangle' },
  improved: { freqs: [523.25, 659.25, 783.99], gap: 0.15, breath: true, wave: 'sine' },
  test: { freqs: [523.25, 783.99], gap: 0.2, breath: true, wave: 'sine' },
};

/** Air moving: band-passed noise that sweeps up and back down, like a slow breath. */
function breath(c: BaseAudioContext, out: AudioNode, t0: number): number {
  const dur = 0.8;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(450, t0);
  band.frequency.exponentialRampToValueAtTime(1500, t0 + dur * 0.45);
  band.frequency.exponentialRampToValueAtTime(600, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.09, t0 + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(band).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + dur);
  return dur * 0.55; // the chime enters as the breath fades
}

/** A soft bell: the note plus a quiet octave, quick attack, long fade. */
function bell(c: BaseAudioContext, out: AudioNode, t: number, freq: number, wave: OscillatorType) {
  for (const [mult, level] of [
    [1, 0.24],
    [2, 0.06],
  ] as const) {
    const osc = c.createOscillator();
    osc.type = mult === 1 ? wave : 'sine';
    osc.frequency.value = freq * mult;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.15);
  }
}

/** Play the chime for an alert. Resolves false when the browser won't play sound yet. */
export async function playAlertSound(kind: AlertKind): Promise<boolean> {
  const c = audio();
  if (!c) return false;
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  if (c.state !== 'running') return false;
  scheduleChime(c, kind, c.currentTime + 0.03);
  return true;
}

/** Schedule the chime on any audio context (an OfflineAudioContext renders it to a buffer). */
export function scheduleChime(c: BaseAudioContext, kind: AlertKind, at: number) {
  const spec = NOTES[kind];
  const master = c.createGain();
  master.gain.value = 0.8;
  const limiter = c.createDynamicsCompressor();
  master.connect(limiter).connect(c.destination);
  let t = at;
  if (spec.breath) t += breath(c, master, t);
  spec.freqs.forEach((f, i) => bell(c, master, t + i * spec.gap, f, spec.wave));
}
