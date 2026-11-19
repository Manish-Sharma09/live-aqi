/**
 * Live weather in the sky scene (SkyScene.astro): snow, rain, drizzle, lightning,
 * fog, pollution haze and heat shimmer, painted on one 2D canvas behind the AQI
 * card. Loaded only on pages whose sky has weather (or a `?wx=` preview).
 *
 * Depth: every particle has a depth z (0 = far, 1 = near). Nearer ones are bigger,
 * faster, brighter and out of focus (bokeh), farther ones small and faint; fog and
 * haze layers sit between them, and the nearest layers shift most with the pointer.
 * A swipe or mouse sweep across the sky pushes the snow, rain and haze nearby.
 *
 * Budget: no WebGL, no per-pixel work per frame (noise and sprites are pre-rendered),
 * capped pixel ratio and density, 60 fps cap, paused off-screen and in hidden tabs,
 * density lowered on low-end devices or when frames run long. With reduced motion
 * the weather is drawn once, standing still, and there is no lightning.
 */
import { hasWeatherEffects, presetSky, skyTokens, type SkyWeather } from '../lib/scene/weather';

// ------------------------------------------------------------ tunables
const FOCUS = 0.5; // depth in sharp focus; nearer and farther flakes soften (bokeh)
const REF_AREA = 600 * 560; // densities below are for a scene this size (px²)
const SNOW_COUNT = 440; // flakes at full intensity
const RAIN_COUNT = 400; // drops at full intensity
const DRIZZLE_COUNT = 460; // drizzle drops at full intensity
const MOTE_COUNT = 140; // haze/dust specks at full smog or heat
const SNOW_FALL = 62; // px/s, nearest flakes
const RAIN_FALL = 1150; // px/s, nearest drops
const DRIZZLE_FALL = 430; // px/s, nearest drizzle
const WIND_PUSH = 85; // px/s sideways at full wind (snow; rain gets more)
const PARALLAX = 18; // px the nearest layer shifts with the pointer
const GUST_RADIUS = 150; // px around the pointer that a sweep pushes
const GUST = 3; // how much of the pointer's speed reaches particles
const GUST_DECAY = 1.6; // per second; how fast a push dies down
const FLASH_GAP: [number, number] = [4500, 11000]; // ms between lightning strikes
const FADE_IN_MS = 1400; // the weather rolls in after the page shows
const MAX_DPR = 2; // fine pointers
const MAX_DPR_TOUCH = 1.5; // phones and tablets
const FRAME_MIN_MS = 15; // ≈60 fps cap (120 Hz screens draw every other frame)

// ------------------------------------------------------------ palettes
interface Palette {
  snow: string; // flake colour, "r,g,b"
  snowEdge: string; // faint rim so flakes read against a pale sky
  rain: string; // "r,g,b" for streaks
  deck: [number, number, number]; // cloud deck
  deckStorm: [number, number, number];
  fog: [number, number, number];
  smog: [number, number, number];
  mote: string; // haze specks
  heatMote: string;
  flash: string;
}
const DAY: Palette = {
  snow: '255,255,255',
  snowEdge: '128,146,176',
  rain: '96,116,146',
  deck: [214, 221, 230],
  deckStorm: [92, 102, 118],
  fog: [236, 239, 243],
  smog: [178, 160, 128],
  mote: '206,182,140', // sunlit dust
  heatMote: '255,226,170',
  flash: '235,240,255',
};
const NIGHT: Palette = {
  snow: '230,238,255',
  snowEdge: '230,238,255',
  rain: '190,208,238',
  deck: [44, 54, 78],
  deckStorm: [22, 27, 42],
  fog: [70, 80, 102],
  smog: [104, 84, 62],
  mote: '255,196,128', // specks lit by street light
  heatMote: '255,210,160',
  flash: '200,215,255',
};

// ------------------------------------------------------------ helpers
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/** Soft round sprite in colour "r,g,b": `soft` 0 = crisp flake, 1 = wide out-of-focus disc. */
function sprite(rgb: string, soft: number, size = 64, edge = rgb): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const core = 0.32 + soft * 0.45; // bokeh discs have a broad, flat core
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(core * 0.6, `rgba(${rgb},1)`);
  grad.addColorStop(Math.min(0.95, core + 0.12), `rgba(${edge},${0.35 - soft * 0.1})`);
  grad.addColorStop(1, `rgba(${edge},0)`);
  g.fillStyle = grad;
  g.globalAlpha = 1 - soft * 0.45;
  g.fillRect(0, 0, size, size);
  return c;
}

/**
 * Tileable (left–right) fractal noise, coloured, with a vertical density profile:
 * the fog banks, haze and cloud deck. Built once per theme; drawn scaled each frame.
 */
function noiseLayer(rgb: [number, number, number], profile: (v: number) => number, seed: number, w = 256, h = 128): HTMLCanvasElement {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const octaves = [
    { cx: 4, cy: 2, amp: 0.55 },
    { cx: 8, cy: 4, amp: 0.25 },
    { cx: 16, cy: 8, amp: 0.13 },
    { cx: 32, cy: 16, amp: 0.07 },
  ].map((o) => ({ ...o, grid: Float32Array.from({ length: o.cx * (o.cy + 1) }, rnd) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const dens = profile(v);
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (const o of octaves) {
        const fx = (x / w) * o.cx;
        const fy = v * o.cy;
        const x0 = Math.floor(fx);
        const y0 = Math.min(o.cy - 1, Math.floor(fy));
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const xa = x0 % o.cx;
        const xb = (x0 + 1) % o.cx; // wraps: the layer tiles horizontally
        const at = (xi: number, yi: number) => o.grid[yi * o.cx + xi]!;
        const top = at(xa, y0) + (at(xb, y0) - at(xa, y0)) * tx;
        const bot = at(xa, y0 + 1) + (at(xb, y0 + 1) - at(xa, y0 + 1)) * tx;
        n += (top + (bot - top) * ty) * o.amp;
      }
      const a = clamp((n - 0.28) / 0.5, 0, 1) * dens;
      const i = (y * w + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------ particles
/** Structure-of-arrays particle pool: no allocation per frame. */
class Pool {
  n = 0;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  ph: Float32Array; // phase / per-particle variety
  gx: Float32Array; // push from the pointer (px/s)
  gy: Float32Array;
  constructor(readonly cap: number) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.ph = new Float32Array(cap);
    this.gx = new Float32Array(cap);
    this.gy = new Float32Array(cap);
  }
  /** Fill up to `n`, spreading new particles over the whole scene. */
  resize(n: number, w: number, h: number, depth: (r: number) => number = (r) => r) {
    n = Math.min(this.cap, Math.max(0, Math.round(n)));
    for (let i = this.n; i < n; i++) {
      this.x[i] = rand(-0.15, 1.15) * w;
      this.y[i] = rand(-0.05, 1) * h;
      this.z[i] = depth(Math.random());
      this.ph[i] = Math.random();
      this.gx[i] = 0;
      this.gy[i] = 0;
    }
    this.n = n;
  }
}

interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
interface Bolt {
  path: Array<[number, number]>;
  branches: Array<Array<[number, number]>>;
}

// ------------------------------------------------------------ the scene
export function mountWeather(scene: HTMLElement, previewSpec: string | null): void {
  const canvas = scene.querySelector<HTMLCanvasElement>('canvas[data-wx-canvas]');
  if (!canvas || canvas.dataset.mounted) return;
  let sky: SkyWeather;
  try {
    sky = JSON.parse(scene.dataset.wx ?? '{}') as SkyWeather;
  } catch {
    return;
  }
  const preview = previewSpec ? presetSky(previewSpec) : null;
  if (preview) {
    sky = preview;
    scene.dataset.sky = skyTokens(sky); // CSS sky tints and rooftop snow follow
  }
  if (!hasWeatherEffects(sky)) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  canvas.dataset.mounted = '1';

  const root = document.documentElement;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !root.classList.contains('motion');
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowEnd = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true;
  let quality = lowEnd ? 0.55 : 1;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let pal = DAY;
  let flakes: HTMLCanvasElement[] = [];
  let moteSprites: HTMLCanvasElement[] = [];
  let deck: HTMLCanvasElement | null = null;
  let haze: HTMLCanvasElement | null = null;
  let hazeKind: 'fog' | 'smog' | null = null;

  const precip = new Pool(Math.max(SNOW_COUNT, RAIN_COUNT, DRIZZLE_COUNT) * 2);
  const motes = new Pool(MOTE_COUNT * 2);
  const splashes: Splash[] = [];
  const ribbons = Array.from({ length: 8 }, () => ({ y: 0, age: 0, life: 1, ph: 0 }));
  ribbons.forEach((r) => resetRibbon(r, true));

  // ---------------------------------------------------------- setup
  function resetRibbon(r: { y: number; age: number; life: number; ph: number }, spread = false) {
    r.life = rand(4, 7.5);
    r.age = spread ? rand(0, r.life) : 0;
    r.y = rand(0.55, 0.97);
    r.ph = Math.random() * 10;
  }

  function buildTheme() {
    pal = root.getAttribute('data-theme') === 'dark' ? NIGHT : DAY;
    flakes = [0, 0.33, 0.66, 1].map((soft) => sprite(pal.snow, soft, 64, pal.snowEdge));
    const moteColor = sky.heat > sky.smog ? pal.heatMote : pal.mote;
    moteSprites = [0.1, 0.8].map((soft) => sprite(moteColor, soft, 32));
    const showDeck = sky.overcast || sky.precip !== 'none' || sky.storm;
    deck = showDeck
      ? noiseLayer(sky.storm ? pal.deckStorm : pal.deck, (v) => Math.pow(1 - v, 1.6), 11, 256, 96)
      : null;
    hazeKind = sky.fog > 0.05 ? 'fog' : sky.smog > 0.08 ? 'smog' : null;
    haze = hazeKind
      ? noiseLayer(hazeKind === 'fog' ? pal.fog : pal.smog, (v) => Math.pow(v, 0.9) * (0.55 + 0.45 * v), 29, 256, 128)
      : null;
  }

  function counts() {
    const area = clamp((W * H) / REF_AREA, 0.45, 1.8) * quality;
    const base = sky.precip === 'snow' ? SNOW_COUNT : sky.precip === 'rain' ? RAIN_COUNT : sky.precip === 'drizzle' ? DRIZZLE_COUNT : 0;
    const amount = 0.35 + 0.65 * sky.amount;
    // Snow reads as deep with more far flakes than near ones.
    precip.resize(base * amount * area, W, H, sky.precip === 'snow' ? (r) => Math.pow(r, 1.35) : (r) => r);
    const dust = Math.max(sky.smog, sky.heat * 0.5);
    motes.resize(MOTE_COUNT * dust * area, W, H);
  }

  function resize() {
    const r = scene.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width;
    H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, touch ? MAX_DPR_TOUCH : MAX_DPR, lowEnd ? 1.25 : 9);
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    counts();
  }

  // ---------------------------------------------------------- pointer
  const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, at: 0, px: 0, py: 0, tx: 0, ty: 0 };
  scene.addEventListener(
    'pointermove',
    (e) => {
      const r = scene.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const now = performance.now();
      const dt = Math.max(8, now - ptr.at) / 1000;
      if (now - ptr.at < 150) {
        ptr.vx = ptr.vx * 0.5 + ((x - ptr.x) / dt) * 0.5;
        ptr.vy = ptr.vy * 0.5 + ((y - ptr.y) / dt) * 0.5;
      } else {
        ptr.vx = 0; // first move after a pause: no speed yet
        ptr.vy = 0;
      }
      ptr.x = x;
      ptr.y = y;
      ptr.at = now;
      if (e.pointerType === 'mouse') {
        ptr.tx = (x / r.width - 0.5) * 2;
        ptr.ty = (y / r.height - 0.5) * 2;
      }
      wake();
    },
    { passive: true },
  );
  scene.addEventListener('pointerleave', () => {
    ptr.tx = 0;
    ptr.ty = 0;
    ptr.vx = 0;
    ptr.vy = 0;
  });

  /** Push from a pointer sweep, by distance; adds to the particle's own push. */
  function gust(p: Pool, i: number, dt: number, sx: number, sy: number, k: number) {
    const dx = sx - ptr.x;
    const dy = sy - ptr.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > GUST_RADIUS * GUST_RADIUS) return;
    const f = 1 - Math.sqrt(d2) / GUST_RADIUS;
    const f2 = f * f * GUST * k * dt * 60 * 0.1;
    p.gx[i] = clamp(p.gx[i]! + ptr.vx * f2, -900, 900);
    p.gy[i] = clamp(p.gy[i]! + ptr.vy * f2, -600, 600);
  }

  // ---------------------------------------------------------- lightning
  let flash = 0;
  let nextStrike = performance.now() + rand(1500, 4000);
  let bolt: Bolt | null = null;
  let boltAt = 0;

  function makeBolt(): Bolt {
    const jag = (x0: number, y0: number, x1: number, y1: number, rough: number, depth: number): Array<[number, number]> => {
      let pts: Array<[number, number]> = [
        [x0, y0],
        [x1, y1],
      ];
      for (let d = 0; d < depth; d++) {
        const next: Array<[number, number]> = [pts[0]!];
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1]!;
          const [bx, by] = pts[i]!;
          const len = Math.hypot(bx - ax, by - ay);
          next.push([(ax + bx) / 2 + rand(-1, 1) * len * rough, (ay + by) / 2 + rand(-0.15, 0.15) * len * rough], [bx, by]);
        }
        pts = next;
      }
      return pts;
    };
    const x0 = rand(0.15, 0.85) * W;
    const path = jag(x0, -10, x0 + rand(-0.18, 0.18) * W, rand(0.42, 0.6) * H, 0.32, 6);
    const branches = Array.from({ length: Math.floor(rand(1, 4)) }, () => {
      const from = path[Math.floor(rand(0.2, 0.7) * path.length)]!;
      return jag(from[0], from[1], from[0] + rand(-0.16, 0.16) * W, from[1] + rand(0.08, 0.2) * H, 0.35, 4);
    });
    return { path, branches };
  }

  // ---------------------------------------------------------- frame
  let t = 0;
  let last = 0;
  let raf = 0;
  let running = false;
  let visible = true;
  let slow = 0; // frame-time watchdog

  function step(dt: number) {
    t += dt;
    ptr.px += (ptr.tx - ptr.px) * Math.min(1, dt * 4);
    ptr.py += (ptr.ty - ptr.py) * Math.min(1, dt * 4);
    const pointerLive = performance.now() - ptr.at < 140;
    const decay = Math.exp(-GUST_DECAY * dt);
    const p = precip;

    if (sky.precip === 'snow') {
      const fall = SNOW_FALL * (0.75 + 0.5 * sky.amount);
      for (let i = 0; i < p.n; i++) {
        const z = p.z[i]!;
        if (pointerLive) gust(p, i, dt, p.x[i]!, p.y[i]!, 0.35 + z);
        p.x[i] = p.x[i]! + (sky.wind * WIND_PUSH * (0.3 + 0.7 * z) + p.gx[i]!) * dt;
        p.y[i] = p.y[i]! + (fall * (0.22 + 0.78 * z) * (0.8 + 0.4 * p.ph[i]!) + p.gy[i]!) * dt;
        p.gx[i] = p.gx[i]! * decay;
        p.gy[i] = p.gy[i]! * decay;
        wrap(p, i, 12);
      }
    } else if (sky.precip !== 'none') {
      const rain = sky.precip === 'rain';
      const fall = (rain ? RAIN_FALL : DRIZZLE_FALL) * (0.8 + 0.3 * sky.amount);
      const side = sky.wind * WIND_PUSH * (rain ? 3 : 1.6);
      for (let i = 0; i < p.n; i++) {
        const z = p.z[i]!;
        if (pointerLive) gust(p, i, dt, p.x[i]!, p.y[i]!, 0.25 + 0.5 * z);
        p.x[i] = p.x[i]! + (side * (0.4 + 0.6 * z) + p.gx[i]!) * dt;
        p.y[i] = p.y[i]! + fall * (0.45 + 0.55 * z) * dt;
        p.gx[i] = p.gx[i]! * decay;
        // Near drops burst on the street; the rest fall out of view behind it.
        const ground = H * (0.8 + 0.17 * z);
        if (rain && z > 0.45 && p.y[i]! > ground) {
          if (splashes.length < 70 && Math.random() < 0.6 * quality) {
            for (let k = 0; k < 2; k++) splashes.push({ x: p.x[i]!, y: ground, vx: rand(-55, 55), vy: rand(-140, -60), life: rand(0.2, 0.34) });
          }
          respawnTop(p, i);
        } else wrap(p, i, 30);
      }
      for (let k = splashes.length - 1; k >= 0; k--) {
        const s = splashes[k]!;
        s.life -= dt;
        if (s.life <= 0) {
          splashes.splice(k, 1);
          continue;
        }
        s.vy += 900 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
    }

    // Haze specks drift with the wind and wander; with heat they rise.
    for (let i = 0; i < motes.n; i++) {
      const z = motes.z[i]!;
      const ph = motes.ph[i]! * 6.283;
      if (pointerLive) gust(motes, i, dt, motes.x[i]!, motes.y[i]!, 0.6);
      motes.x[i] = motes.x[i]! + (sky.wind * 22 + Math.sin(t * 0.31 + ph) * 7 + motes.gx[i]!) * dt * (0.5 + z);
      motes.y[i] = motes.y[i]! + (Math.sin(t * 0.23 + ph * 2) * 5 - sky.heat * 9 + motes.gy[i]!) * dt * (0.5 + z);
      motes.gx[i] = motes.gx[i]! * decay;
      motes.gy[i] = motes.gy[i]! * decay;
      if (motes.x[i]! > W * 1.1) motes.x[i] = -W * 0.1;
      else if (motes.x[i]! < -W * 0.1) motes.x[i] = W * 1.1;
      if (motes.y[i]! < -10) motes.y[i] = H + 5;
      else if (motes.y[i]! > H + 10) motes.y[i] = -5;
    }

    if (sky.heat > 0.05) {
      for (const r of ribbons) {
        r.age += dt;
        r.y -= 0.018 * dt * (0.6 + sky.heat); // warm air rises
        if (r.age > r.life) resetRibbon(r);
      }
    }

    if (sky.storm && !still) {
      const now = performance.now();
      if (now >= nextStrike) {
        bolt = makeBolt();
        boltAt = now;
        nextStrike = now + rand(FLASH_GAP[0], FLASH_GAP[1]);
      }
      // Two pulses within ~0.5 s (well under 3 flashes a second), then darkness.
      const since = now - boltAt;
      flash = bolt ? (since < 90 ? 1 : since < 150 ? 0.25 : since < 230 ? 0.7 : Math.max(0, 0.7 * (1 - (since - 230) / 420))) : 0;
      if (bolt && since > 700) bolt = null;
    }
  }

  function wrap(p: Pool, i: number, pad: number) {
    if (p.y[i]! > H + pad) respawnTop(p, i);
    else if (p.y[i]! < -H * 0.3) p.y[i] = H + pad - 1;
    if (p.x[i]! > W * 1.2) p.x[i] = p.x[i]! - W * 1.4;
    else if (p.x[i]! < -W * 0.2) p.x[i] = p.x[i]! + W * 1.4;
  }
  function respawnTop(p: Pool, i: number) {
    p.y[i] = rand(-40, -8);
    p.x[i] = rand(-0.2, 1.2) * W;
    p.gx[i] = 0;
    p.gy[i] = 0;
  }

  function drawLayer(img: HTMLCanvasElement, y: number, h: number, scale: number, speed: number, alpha: number, depth: number) {
    const w = W * scale;
    const shift = ((((t * speed + ptr.px * PARALLAX * depth) % w) + w) % w);
    const dy = -ptr.py * PARALLAX * 0.4 * depth;
    ctx!.globalAlpha = alpha;
    ctx!.drawImage(img, -shift, y + dy, w, h);
    ctx!.drawImage(img, w - shift, y + dy, w, h);
    if (w * 2 - shift < W) ctx!.drawImage(img, w * 2 - shift, y + dy, w, h);
  }

  function draw() {
    const c = ctx!;
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    const wind = sky.wind * 14;

    // Cloud deck across the top of the sky.
    if (deck) {
      const a = sky.storm ? 0.95 : sky.precip !== 'none' ? 0.75 : 0.6;
      drawLayer(deck, -H * 0.04, H * 0.5, 1.6, 5 + wind, a, 0.15);
      drawLayer(deck, -H * 0.08, H * 0.42, 1.25, 11 + wind * 1.5, a * 0.7, 0.3);
    }

    // Lightning lights the clouds from inside, then the bolt.
    if (bolt && flash > 0) drawBolt(c);

    // Heat: the sun's glare and warm air near the ground.
    if (sky.heat > 0.05) {
      const pulse = 1 + Math.sin(t * 0.9) * 0.08;
      const sun = c.createRadialGradient(W * 0.86, H * 0.12, 0, W * 0.86, H * 0.12, Math.max(W, H) * 0.7 * pulse);
      sun.addColorStop(0, `rgba(255,214,140,${0.42 * sky.heat})`);
      sun.addColorStop(0.35, `rgba(255,196,120,${0.16 * sky.heat})`);
      sun.addColorStop(1, 'rgba(255,190,110,0)');
      c.globalAlpha = 1;
      c.fillStyle = sun;
      c.fillRect(0, 0, W, H);
      const ground = c.createLinearGradient(0, H * 0.45, 0, H);
      ground.addColorStop(0, 'rgba(255,170,90,0)');
      ground.addColorStop(1, `rgba(255,170,90,${0.2 * sky.heat})`);
      c.fillStyle = ground;
      c.fillRect(0, H * 0.45, W, H * 0.55);
    }

    // Far half of the particles, then the haze, then the near half: depth.
    drawParticles(c, 0, 0.5);
    drawMotes(c, 0, 0.5);

    if (haze && hazeKind) {
      const k = hazeKind === 'fog' ? sky.fog : sky.smog;
      const tint = hazeKind === 'fog' ? pal.fog : pal.smog;
      // A veil over the whole sky, thickest at street level: the skyline fades into it.
      const veil = c.createLinearGradient(0, 0, 0, H);
      veil.addColorStop(0, `rgba(${tint.join(',')},${(hazeKind === 'fog' ? 0.18 : 0.12) * k})`);
      veil.addColorStop(0.45, `rgba(${tint.join(',')},${(hazeKind === 'fog' ? 0.35 : 0.2) * k})`);
      veil.addColorStop(1, `rgba(${tint.join(',')},${(hazeKind === 'fog' ? 0.72 : 0.5) * k})`);
      c.globalAlpha = 1;
      c.fillStyle = veil;
      c.fillRect(0, 0, W, H);
      drawLayer(haze, H * 0.2, H * 0.85, 1.7, 6 + wind, 0.75 * k, 0.25);
      drawLayer(haze, H * 0.32, H * 0.75, 1.3, 13 + wind * 1.5, 0.65 * k, 0.55);
    }

    drawParticles(c, 0.5, 1.01);
    drawMotes(c, 0.5, 1.01);

    if (sky.heat > 0.05) drawShimmer(c);

    if (haze && hazeKind) {
      // The nearest bank drifts in front of everything.
      const k = hazeKind === 'fog' ? sky.fog : sky.smog;
      drawLayer(haze, H * 0.45, H * 0.6, 1.15, 22 + wind * 2, 0.45 * k, 0.9);
    }

    if (flash > 0) {
      c.globalAlpha = flash * 0.22;
      c.fillStyle = `rgb(${pal.flash})`;
      c.fillRect(0, 0, W, H);
    }
    c.globalAlpha = 1;
  }

  function drawParticles(c: CanvasRenderingContext2D, z0: number, z1: number) {
    const p = precip;
    if (!p.n) return;
    const ox = -ptr.px * PARALLAX;
    const oy = -ptr.py * PARALLAX * 0.5;
    if (sky.precip === 'snow') {
      const grains = sky.amount < 0.32;
      for (let i = 0; i < p.n; i++) {
        const z = p.z[i]!;
        if (z < z0 || z >= z1) continue;
        const ph = p.ph[i]!;
        // Each flake flutters on its own rhythm as it falls.
        const sway = Math.sin(t * (0.7 + ph * 0.9) + ph * 6.283) * (6 + 16 * z);
        const blur = Math.min(3, Math.floor(Math.abs(z - FOCUS) * 6.5));
        const size = (grains ? 1.1 : 1.7) + (grains ? 2.2 : 6.4) * Math.pow(z, 1.6) * (0.75 + 0.5 * ph);
        const d = size * (2 + blur * 0.7);
        c.globalAlpha = (0.5 + 0.5 * z) * (blur === 3 ? 0.6 : 1);
        c.drawImage(flakes[blur]!, p.x[i]! + sway + ox * z - d / 2, p.y[i]! + oy * z - d / 2, d, d);
      }
      return;
    }
    // Rain and drizzle: streaks along their motion, batched by depth band.
    const rain = sky.precip === 'rain';
    const fall = (rain ? RAIN_FALL : DRIZZLE_FALL) * (0.8 + 0.3 * sky.amount);
    const side = sky.wind * WIND_PUSH * (rain ? 3 : 1.6);
    const bands: Array<[number, number, number, number]> = rain
      ? [
          [0, 0.4, 0.7, 0.2],
          [0.4, 0.75, 1.1, 0.3],
          [0.75, 1.01, 1.7, 0.42],
        ]
      : [
          [0, 0.5, 0.6, 0.2],
          [0.5, 1.01, 0.9, 0.3],
        ];
    const len = rain ? 0.024 : 0.03;
    for (const [b0, b1, width, alpha] of bands) {
      const lo = Math.max(b0, z0);
      const hi = Math.min(b1, z1);
      if (lo >= hi) continue;
      c.beginPath();
      for (let i = 0; i < p.n; i++) {
        const z = p.z[i]!;
        if (z < lo || z >= hi) continue;
        const vy = fall * (0.45 + 0.55 * z);
        const vx = side * (0.4 + 0.6 * z) + p.gx[i]!;
        const k = len * (0.55 + 0.45 * z);
        const x = p.x[i]! + ox * z;
        const y = p.y[i]! + oy * z;
        c.moveTo(x, y);
        c.lineTo(x - vx * k, y - vy * k);
      }
      c.globalAlpha = 1;
      c.lineWidth = width;
      c.lineCap = 'round';
      c.strokeStyle = `rgba(${pal.rain},${alpha * (0.7 + 0.3 * sky.amount)})`;
      c.stroke();
    }
    if (z1 > 1 && splashes.length) {
      c.fillStyle = `rgba(${pal.rain},0.5)`;
      for (const s of splashes) c.fillRect(s.x + ox, s.y + oy, 1.4, 1.4);
    }
  }

  function drawMotes(c: CanvasRenderingContext2D, z0: number, z1: number) {
    if (!motes.n) return;
    const ox = -ptr.px * PARALLAX;
    const oy = -ptr.py * PARALLAX * 0.5;
    const strength = Math.max(sky.smog, sky.heat * 0.6);
    for (let i = 0; i < motes.n; i++) {
      const z = motes.z[i]!;
      if (z < z0 || z >= z1) continue;
      const soft = z > 0.6 ? 1 : 0;
      const d = (1 + 2.6 * z) * (soft ? 2.8 : 1.8);
      // Specks glint in and out as they turn.
      const glint = 0.45 + 0.55 * Math.sin(t * (0.8 + motes.ph[i]!) + motes.ph[i]! * 9);
      c.globalAlpha = (0.2 + 0.4 * z) * glint * (0.4 + 0.6 * strength);
      c.drawImage(moteSprites[soft]!, motes.x[i]! + ox * z - d / 2, motes.y[i]! + oy * z - d / 2, d, d);
    }
  }

  function drawShimmer(c: CanvasRenderingContext2D) {
    c.lineCap = 'round';
    for (const r of ribbons) {
      const env = Math.sin((Math.PI * r.age) / r.life);
      if (env <= 0) continue;
      const y = r.y * H;
      c.globalAlpha = env * 0.16 * sky.heat;
      c.strokeStyle = 'rgba(255,250,240,1)';
      c.lineWidth = 2.2;
      c.beginPath();
      for (let x = -10; x <= W + 10; x += 18) {
        const yy = y + Math.sin(x * 0.032 + t * 1.7 + r.ph) * 2.6 + Math.sin(x * 0.011 - t * 0.9 + r.ph) * 3.5;
        if (x === -10) c.moveTo(x, yy);
        else c.lineTo(x, yy);
      }
      c.stroke();
    }
  }

  function drawBolt(c: CanvasRenderingContext2D) {
    if (!bolt) return;
    const glow = c.createRadialGradient(bolt.path[0]![0], H * 0.15, 0, bolt.path[0]![0], H * 0.15, W * 0.6);
    glow.addColorStop(0, `rgba(${pal.flash},${0.5 * flash})`);
    glow.addColorStop(1, `rgba(${pal.flash},0)`);
    c.globalAlpha = 1;
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);
    const line = (pts: Array<[number, number]>, width: number, color: string) => {
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.lineWidth = width;
      c.strokeStyle = color;
      c.stroke();
    };
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.globalAlpha = flash;
    for (const b of [bolt.path, ...bolt.branches]) line(b, b === bolt.path ? 7 : 4, `rgba(${pal.flash},0.28)`);
    for (const b of [bolt.path, ...bolt.branches]) line(b, b === bolt.path ? 1.8 : 1, 'rgba(255,255,255,0.95)');
  }

  // ---------------------------------------------------------- loop
  function frame(now: number) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const gap = now - last;
    if (gap < FRAME_MIN_MS) return;
    last = now;
    // Watchdog: if frames keep running long, thin out the weather (never below a third).
    slow = slow * 0.95 + (gap > 26 ? 1 : 0) * 0.05;
    if (slow > 0.6 && quality > 0.35) {
      quality = Math.max(0.35, quality * 0.75);
      slow = 0;
      counts();
    }
    step(Math.min(0.05, gap / 1000));
    draw();
  }
  function wake() {
    if (still || running || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    raf ||= requestAnimationFrame(frame);
  }
  function sleep() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function renderStill() {
    step(0);
    draw();
  }

  // ---------------------------------------------------------- start
  buildTheme();
  resize();
  canvas.style.setProperty('--wx-fade', `${FADE_IN_MS}ms`);
  requestAnimationFrame(() => canvas.classList.add('is-on'));

  new ResizeObserver(() => {
    resize();
    if (still) renderStill();
  }).observe(scene);
  new MutationObserver(() => {
    buildTheme();
    if (still) renderStill();
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  if (still) {
    // Reduced motion: the weather is shown, standing still.
    for (let i = 0; i < 3; i++) step(0.016);
    draw();
    return;
  }
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    if (visible) wake();
    else sleep();
  }).observe(scene);
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  wake();
}
