/**
 * Motion + liquid-glass behaviour (styles in src/styles/liquid.css).
 *
 * Everything here is progressive: pages are complete without it, nothing runs
 * under prefers-reduced-motion except the static glass, and continuous work
 * (pointer easing, the sky) only runs while something is actually moving.
 */

// ------------------------------------------------------------ tunables
const STAGGER_MS = 70; // between items revealed together
const STAGGER_MAX = 6; // later items in a batch share the last delay
const COUNT_MS = 900; // AQI count-up duration
const SHEEN_EASE = 0.2; // pointer highlight follow (0..1, lower = more lag)
const DEPTH_EASE = 0.08; // sky parallax follow
const LENS_BEZEL = 22; // px of refracting edge on [data-lens] glass
const LENS_STRENGTH = 64; // displacement scale (the rim samples up to half of this, in px)
const LENS_BLUR = '6px'; // backdrop blur used with the lens (less than plain glass, so the bend shows)
const INK_GROW_MS = 650; // click bloom spreads from the pointer…
const INK_FADE_MS = 550; // …and fades once released
const INK_MIN_MS = 160; // a quick tap still shows the bloom this long
const INK_REACH = 1.15; // bloom radius, relative to the farthest corner
const INK_TOUCH_DELAY_MS = 70; // on touch, wait this long so starting a scroll doesn't flash a button
const GLIDE_MS = 460; // segmented-control thumb glides to the new option

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'; // --ease-out
const EASE_SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)'; // --ease-spring
/** Controls with the shared press (liquid.css "press") and the click bloom. */
const PRESSABLE = '.btn, .glass-pill, .seg > a, .seg > button, .vt-nav-thumb, [data-press]';

const root = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reduceTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const motionOn = root.classList.contains('motion') && !reduceMotion;
const arrivedByTransition = root.classList.contains('vt-arrival');

root.classList.add('motion-ready');

/** Resolves once the arrival splash (Preloader.astro) has lifted; at once if there isn't one. */
const pageShown = new Promise<void>((resolve) => {
  if (!root.classList.contains('preloading')) return resolve();
  window.addEventListener('laqi:preloaded', () => resolve(), { once: true });
});

// --------------------------------------------------------- scroll reveals
function initReveals() {
  for (const group of document.querySelectorAll<HTMLElement>('[data-reveal-stagger]')) {
    for (const child of group.children) child.setAttribute('data-reveal', '');
  }
  const items = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
  if (!items.length) return;
  if (!motionOn || !('IntersectionObserver' in window)) {
    for (const el of items) el.removeAttribute('data-reveal');
    return;
  }
  const finish = (el: HTMLElement) => {
    const done = (e: TransitionEvent) => {
      if (e.target !== el || e.propertyName !== 'transform') return;
      el.removeEventListener('transitionend', done);
      el.removeAttribute('data-reveal');
      el.classList.remove('is-revealed');
      el.style.removeProperty('--reveal-delay');
    };
    el.addEventListener('transitionend', done);
  };
  const io = new IntersectionObserver(
    (entries) => {
      let k = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        io.unobserve(el);
        // Items entering together cascade; a lone item starts at once.
        el.style.setProperty('--reveal-delay', `${Math.min(k++, STAGGER_MAX) * STAGGER_MS}ms`);
        el.classList.add('is-revealed');
        finish(el);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  void pageShown.then(() => {
    for (const el of items) io.observe(el);
  });
}

// ------------------------------------------------------------- header
function initHeader() {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (!header) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    header.toggleAttribute('data-scrolled', window.scrollY > 4);
  };
  update();
  window.addEventListener('scroll', () => (raf ||= requestAnimationFrame(update)), { passive: true });
}

// ---------------------------------------------- pointer light on glass
function initSheen() {
  if (!finePointer || reduceMotion) return;
  let el: HTMLElement | null = null; // glass under the pointer (or easing back)
  let leaving = false;
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let raf = 0;

  const restingPoint = (g: HTMLElement) => {
    const r = g.getBoundingClientRect();
    return [r.width * 0.22, r.height * -0.1] as const; // matches the CSS default
  };
  const tick = () => {
    raf = 0;
    if (!el) return;
    cx += (tx - cx) * SHEEN_EASE;
    cy += (ty - cy) * SHEEN_EASE;
    el.style.setProperty('--gx', `${cx.toFixed(1)}px`);
    el.style.setProperty('--gy', `${cy.toFixed(1)}px`);
    if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) {
      raf = requestAnimationFrame(tick);
    } else if (leaving) {
      el.style.removeProperty('--gx');
      el.style.removeProperty('--gy');
      el = null;
      leaving = false;
    }
  };
  const release = () => {
    if (!el || leaving) return;
    el.style.removeProperty('--sheen');
    [tx, ty] = restingPoint(el);
    leaving = true;
    raf ||= requestAnimationFrame(tick);
  };

  const clear = (g: HTMLElement) => {
    for (const p of ['--sheen', '--gx', '--gy']) g.style.removeProperty(p);
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const g = (e.target as Element | null)?.closest?.<HTMLElement>('.glass, .glass-pill') ?? null;
      if (!g) return release(); // eases back to rest
      if (g !== el) {
        if (el) clear(el); // hand over at once; the old glass fades to its default
        el = g;
        [cx, cy] = restingPoint(g);
        leaving = true; // forces --sheen on below
      }
      if (leaving) {
        leaving = false;
        g.style.setProperty('--sheen', '1');
      }
      const r = g.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
      raf ||= requestAnimationFrame(tick);
    },
    { passive: true },
  );
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) release(); // left the window
  });
}

// ------------------------------------------------ click bloom on buttons
/** Light spreading through `host` from a point (its centre if none); returns `release`. */
function bloom(host: HTMLElement, clientX?: number, clientY?: number): () => void {
  const r = host.getBoundingClientRect();
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (!w || !h || !r.width) return () => {};
  const k = host.offsetWidth / r.width; // undo the press scale already under way
  const x = clientX === undefined ? w / 2 : (clientX - r.left) * k - host.clientLeft;
  const y = clientY === undefined ? h / 2 : (clientY - r.top) * k - host.clientTop;
  const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) * INK_REACH;

  const ink = document.createElement('span');
  ink.className = 'press-ink';
  ink.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    left: `${x - radius}px`,
    top: `${y - radius}px`,
    width: `${radius * 2}px`,
    height: `${radius * 2}px`,
  });
  ink.appendChild(dot); // not append(): the Workers types redeclare it
  host.appendChild(ink);
  dot.animate(
    [{ transform: 'scale(0.12)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: INK_GROW_MS, easing: EASE_OUT, fill: 'forwards' },
  );

  const born = performance.now();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    window.setTimeout(
      () => {
        const from = getComputedStyle(dot).opacity; // fade from wherever the bloom has got to
        dot
          .animate([{ opacity: from }, { opacity: 0 }], { duration: INK_FADE_MS, easing: EASE_OUT, fill: 'forwards' })
          .finished.catch(() => {})
          .finally(() => ink.remove());
      },
      Math.max(0, INK_MIN_MS - (performance.now() - born)),
    );
  };
}

function initPressInk() {
  if (reduceMotion || typeof Element.prototype.animate !== 'function') return;
  const pressable = (e: Event) => {
    const host = (e.target as Element | null)?.closest?.<HTMLElement>(PRESSABLE);
    return host && !host.matches(':disabled, [aria-disabled="true"]') ? host : null;
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      const host = pressable(e);
      if (!host) return;
      const { clientX, clientY } = e;
      let release: (() => void) | null = null;
      const start = () => (release = bloom(host, clientX, clientY));
      // On touch, wait a beat: if the finger turns out to be scrolling, nothing flashes.
      let timer = 0;
      if (e.pointerType === 'touch') timer = window.setTimeout(start, INK_TOUCH_DELAY_MS);
      else start();
      const done = new AbortController();
      const end = (ev: Event) => {
        done.abort();
        window.clearTimeout(timer);
        (release ?? (ev.type === 'pointerup' ? start() : null))?.();
      };
      for (const type of ['pointerup', 'pointercancel', 'dragstart']) {
        window.addEventListener(type, end, { capture: true, signal: done.signal });
      }
    },
    { passive: true },
  );

  // Enter / Space (and other clicks without a pointer) bloom from the centre.
  document.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const host = pressable(e);
    if (host) bloom(host)();
  });
}

// ------------------------------------- segmented control: thumb glides
/**
 * When a .seg button becomes the pressed one, its raised thumb (::before) starts
 * where the old one was and glides across, instead of one fading out while the
 * other fades in. Links in a .seg navigate, and a view transition carries theirs.
 */
function initSegGlide() {
  const segs = document.querySelectorAll<HTMLElement>('.seg');
  if (!segs.length || !motionOn || !('MutationObserver' in window)) return;
  // Needs per-pseudo-element animation; without it the CSS fade stays.
  try {
    const probe = root.animate(null, { pseudoElement: '::before' });
    const ok = (probe.effect as KeyframeEffect | null)?.pseudoElement === '::before';
    probe.cancel();
    if (!ok) return;
  } catch {
    return;
  }

  const glide = (from: HTMLElement, to: HTMLElement) => {
    if (from.offsetParent !== to.offsetParent || from.offsetTop !== to.offsetTop) return; // wrapped onto two rows
    const left = from.offsetLeft - to.offsetLeft;
    const right = to.offsetLeft + to.offsetWidth - (from.offsetLeft + from.offsetWidth);
    const opts = { duration: GLIDE_MS, easing: EASE_SPRING, pseudoElement: '::before' };
    // Insets, not scaleX, so the pill keeps its round ends while it stretches.
    to.animate(
      [
        { left: `${left}px`, right: `${right}px`, opacity: 1, transform: 'none' },
        { left: '0px', right: '0px', opacity: 1, transform: 'none' },
      ],
      opts,
    );
    from.animate({ opacity: [0, 0] }, opts); // the old thumb has moved, so it doesn't fade out behind
  };

  const mo = new MutationObserver((records) => {
    const moves = new Map<Element, { from?: HTMLElement; to?: HTMLElement }>();
    for (const rec of records) {
      const el = rec.target as HTMLElement;
      const seg = el.parentElement;
      if (!seg?.classList.contains('seg')) continue;
      const now = el.getAttribute(rec.attributeName ?? '') === 'true';
      if (now === (rec.oldValue === 'true')) continue;
      const move = moves.get(seg) ?? {};
      move[now ? 'to' : 'from'] = el;
      moves.set(seg, move);
    }
    for (const { from, to } of moves.values()) if (from && to && from !== to) glide(from, to);
  });
  for (const seg of segs) {
    mo.observe(seg, { subtree: true, attributeFilter: ['aria-pressed', 'aria-selected'], attributeOldValue: true });
  }
}

// -------------------------------------------------- the sky over a place
function initScenes() {
  const scenes = [...document.querySelectorAll<HTMLElement>('.scene')];
  if (!scenes.length) return;

  // Pause the ambient sky while it's scrolled away.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.target as HTMLElement).toggleAttribute('data-offscreen', !e.isIntersecting);
    });
    for (const s of scenes) io.observe(s);
  }

  if (!finePointer || reduceMotion) return;
  for (const scene of scenes) {
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let raf = 0;
    const tick = () => {
      raf = 0;
      cx += (tx - cx) * DEPTH_EASE;
      cy += (ty - cy) * DEPTH_EASE;
      scene.style.setProperty('--px', cx.toFixed(3));
      scene.style.setProperty('--py', cy.toFixed(3));
      if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) raf = requestAnimationFrame(tick);
    };
    scene.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = scene.getBoundingClientRect();
        tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
        ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
        raf ||= requestAnimationFrame(tick);
      },
      { passive: true },
    );
    scene.addEventListener('pointerleave', () => {
      tx = 0;
      ty = 0;
      raf ||= requestAnimationFrame(tick);
    });
  }
}

// --------------------------------------------------------- AQI count-up
async function initCountUps() {
  if (!motionOn || arrivedByTransition) return;
  await pageShown;
  for (const el of document.querySelectorAll<HTMLElement>('[data-count-to]')) {
    const to = Number(el.dataset.countTo);
    if (!Number.isFinite(to) || to <= 0) continue;
    const start = performance.now() + 120;
    el.textContent = '0';
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
      const eased = 1 - Math.pow(1 - p, 4); // fast start, gentle landing
      el.textContent = String(Math.round(to * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// ------------------------------------------------- chart line draws in
function initChartDraw() {
  const plots = [...document.querySelectorAll<HTMLElement>('[data-draw-in]')];
  if (!plots.length || !motionOn || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const plot = entry.target as HTMLElement;
        io.unobserve(plot);
        const lines = plot.querySelectorAll<SVGPathElement>('svg path[fill="none"]:not([stroke-dasharray])');
        for (const p of lines) p.setAttribute('pathLength', '1');
        plot.classList.add('chart-intro');
        window.setTimeout(() => {
          plot.classList.remove('chart-intro');
          for (const p of lines) p.removeAttribute('pathLength');
        }, 2200);
      }
    },
    { threshold: 0.35 },
  );
  void pageShown.then(() => {
    for (const p of plots) io.observe(p);
  });
}

// ------------------------------------- refraction (Chromium, desktop only)
/**
 * Displacement map for a rounded rectangle: inside a bezel along the edge, each
 * pixel points inward (red = x, green = y, 128 = none), so the backdrop bends at
 * the rim like the edge of a lens.
 */
function lensMap(w: number, h: number, radius: number, bezel: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hx = w / 2 - radius;
  const hy = h / 2 - radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - hx;
      const qy = Math.abs(py) - hy;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const depth = radius - outside - Math.min(Math.max(qx, qy), 0); // distance in from the edge
      let mx = 0;
      let my = 0;
      if (depth < bezel) {
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          nx = ox / (outside || 1);
          ny = oy / (outside || 1);
        } else if (qx > qy) {
          nx = 1;
          ny = 0;
        } else {
          nx = 0;
          ny = 1;
        }
        const t = 1 - Math.max(depth, 0) / bezel; // 1 at the rim, 0 at the bezel's inner edge
        const m = t * t; // curved like a lens edge
        mx = -Math.sign(px) * nx * m;
        my = -Math.sign(py) * ny * m;
      }
      const i = (y * w + x) * 4;
      d[i] = 128 + mx * 127;
      d[i + 1] = 128 + my * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function initLenses() {
  const isChromium = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands?.some(
    (b) => b.brand === 'Chromium',
  );
  const targets = [...document.querySelectorAll<HTMLElement>('[data-lens]')];
  if (!isChromium || !finePointer || reduceTransparency || !targets.length || !('ResizeObserver' in window)) return;

  const NS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(NS, 'svg');
  defs.setAttribute('aria-hidden', 'true');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.style.position = 'absolute';
  document.body.appendChild(defs);

  targets.forEach((el, n) => {
    const id = `lg-lens-${n}`;
    const filter = document.createElementNS(NS, 'filter');
    filter.id = id;
    for (const [k, v] of Object.entries({ x: '0', y: '0', filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) {
      filter.setAttribute(k, v);
    }
    const map = document.createElementNS(NS, 'feImage');
    map.setAttribute('x', '0');
    map.setAttribute('y', '0');
    map.setAttribute('preserveAspectRatio', 'none');
    map.setAttribute('result', 'map');
    const displace = document.createElementNS(NS, 'feDisplacementMap');
    displace.setAttribute('in', 'SourceGraphic');
    displace.setAttribute('in2', 'map');
    displace.setAttribute('scale', String(LENS_STRENGTH));
    displace.setAttribute('xChannelSelector', 'R');
    displace.setAttribute('yChannelSelector', 'G');
    filter.appendChild(map);
    filter.appendChild(displace);
    defs.appendChild(filter);

    let timer = 0;
    let built = '';
    const build = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (w < 8 || h < 8 || `${w}x${h}` === built) return;
      built = `${w}x${h}`;
      const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
      for (const node of [filter, map]) {
        node.setAttribute('width', String(w));
        node.setAttribute('height', String(h));
      }
      map.setAttribute('href', lensMap(w, h, radius, LENS_BEZEL));
      const sat = getComputedStyle(root).getPropertyValue('--lg-saturate').trim() || '1.7';
      el.style.backdropFilter = `url(#${id}) blur(${LENS_BLUR}) saturate(${sat})`;
    };
    new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(build, built ? 160 : 0);
    }).observe(el);
  });
  root.classList.add('lg-refract');
}

initReveals();
initHeader();
initSheen();
initPressInk();
initSegGlide();
initScenes();
void initCountUps();
initChartDraw();
initLenses();
