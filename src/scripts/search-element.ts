/**
 * <laqi-search> — accessible location combobox (ARIA 1.2 pattern).
 *
 * data-mode:
 *   "navigate"      open the selected result's dashboard (default)
 *   "set-location"  save the result as "my location" and reload the homepage
 *   "event"         dispatch `laqi:search-select` (used by the map and alerts page)
 */
import { saveLocation } from './store';

interface Result {
  type: 'city' | 'place' | 'country' | 'region' | 'station';
  title: string;
  subtitle: string;
  href: string;
  loc?: string;
  lat?: number;
  lon?: number;
  aqi?: { value: number; standard: 'us' | 'in'; label: string; color: string };
}

const TYPE_LABEL: Record<Result['type'], string> = {
  city: 'City',
  place: 'Place',
  country: 'Country',
  region: 'Region',
  station: 'Station',
};

let uid = 0;

class LaqiSearch extends HTMLElement {
  private input!: HTMLInputElement;
  private list!: HTMLUListElement;
  private status!: HTMLElement;
  private results: Result[] = [];
  private active = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private lastQuery = '';

  connectedCallback() {
    if (this.input) return;
    const input = this.querySelector<HTMLInputElement>('input[role="combobox"]');
    const list = this.querySelector<HTMLUListElement>('[role="listbox"]');
    const status = this.querySelector<HTMLElement>('[data-status]');
    if (!input || !list || !status) return;
    this.input = input;
    this.list = list;
    this.status = status;
    const id = `laqi-listbox-${++uid}`;
    list.id = id;
    input.setAttribute('aria-controls', id);

    input.addEventListener('input', () => this.onInput());
    input.addEventListener('keydown', (e) => this.onKey(e));
    input.addEventListener('focus', () => {
      if (this.results.length) this.open(true);
    });
    this.addEventListener('focusout', (e) => {
      if (!this.contains(e.relatedTarget as Node | null)) this.open(false);
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('[role="option"]');
      if (li) this.select(Number(li.dataset.index));
    });
  }

  focusInput() {
    this.input?.focus();
    this.input?.select();
  }

  private get mode() {
    return this.dataset.mode ?? 'navigate';
  }

  private open(show: boolean) {
    this.list.hidden = !show;
    this.input.setAttribute('aria-expanded', String(show));
  }

  private setStatus(text: string, visible = true) {
    this.status.textContent = text;
    this.status.hidden = !visible || !text;
  }

  private onInput() {
    const q = this.input.value.trim();
    clearTimeout(this.timer);
    if (q.length < 2) {
      this.controller?.abort();
      this.results = [];
      this.render();
      this.setStatus(q.length === 1 ? 'Keep typing…' : '', q.length === 1);
      return;
    }
    this.setStatus('Searching…');
    this.timer = setTimeout(() => this.search(q), 180);
  }

  private async search(q: string) {
    this.controller?.abort();
    this.controller = new AbortController();
    this.lastQuery = q;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: this.controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { results: Result[] };
      if (q !== this.lastQuery) return;
      // Only places can become "my location"; countries and regions are browse-only.
      const locatableOnly = this.mode === 'set-location' || this.dataset.locatable === 'true';
      this.results = locatableOnly ? body.results.filter((r) => r.loc) : body.results;
      this.active = this.results.length ? 0 : -1;
      this.render();
      if (this.results.length === 0) {
        this.setStatus(`No places match “${q}”. Check the spelling, or try a larger city nearby.`);
      } else {
        this.setStatus(`${this.results.length} result${this.results.length === 1 ? '' : 's'}`, false);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.results = [];
      this.render();
      this.setStatus('Search is unavailable right now. Please try again in a moment.');
    }
  }

  private render() {
    this.list.replaceChildren(
      ...this.results.map((r, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `${this.list.id}-opt-${i}`;
        li.dataset.index = String(i);
        li.setAttribute('aria-selected', String(i === this.active));
        li.className =
          'flex cursor-pointer items-center gap-3 px-3 py-2.5 aria-selected:bg-[var(--opt-active)] hover:bg-[var(--opt-hover)]';

        const type = document.createElement('span');
        type.className = 'label w-16 shrink-0 text-[0.625rem] opacity-60';
        type.textContent = TYPE_LABEL[r.type];

        const text = document.createElement('span');
        text.className = 'min-w-0 flex-1';
        const title = document.createElement('span');
        title.className = 'block truncate font-semibold';
        title.textContent = r.title;
        const sub = document.createElement('span');
        sub.className = 'block truncate text-sm opacity-70';
        sub.textContent = r.subtitle;
        text.appendChild(title);
        text.appendChild(sub);
        li.appendChild(type);
        li.appendChild(text);

        if (r.aqi) {
          const badge = document.createElement('span');
          badge.className = 'aqi-badge';
          badge.style.setProperty('--cat', r.aqi.color);
          badge.style.setProperty('--cat-ink', luminance(r.aqi.color) > 0.18 ? '#000' : '#fff');
          badge.textContent = String(r.aqi.value);
          badge.title = `${r.aqi.standard === 'in' ? 'India NAQI' : 'US AQI'} ${r.aqi.value} — ${r.aqi.label}`;
          li.appendChild(badge);
        }
        return li;
      }),
    );
    this.open(this.results.length > 0);
    this.updateActive();
  }

  private updateActive() {
    const options = this.list.querySelectorAll<HTMLElement>('[role="option"]');
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === this.active)));
    const current = options[this.active];
    if (current) {
      this.input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.results.length) return;
      e.preventDefault();
      this.open(true);
      const n = this.results.length;
      this.active = e.key === 'ArrowDown' ? (this.active + 1) % n : (this.active - 1 + n) % n;
      this.updateActive();
    } else if (e.key === 'Enter') {
      if (this.active >= 0 && this.results[this.active]) {
        e.preventDefault();
        this.select(this.active);
      }
    } else if (e.key === 'Escape') {
      if (!this.list.hidden) {
        e.stopPropagation();
        this.open(false);
      } else if (this.input.value) {
        e.stopPropagation();
        this.input.value = '';
        this.onInput();
      }
    }
  }

  private select(i: number) {
    const r = this.results[i];
    if (!r) return;
    this.open(false);
    if (this.mode === 'event') {
      this.dispatchEvent(new CustomEvent('laqi:search-select', { detail: r, bubbles: true }));
      this.input.value = r.title;
      return;
    }
    if (this.mode === 'set-location' && r.loc) {
      saveLocation({ token: r.loc, name: r.title, subtitle: r.subtitle, href: r.href, precise: false });
      window.location.assign('/');
      return;
    }
    window.location.assign(r.href);
  }
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = Number.parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

if (!customElements.get('laqi-search')) customElements.define('laqi-search', LaqiSearch);

export type { LaqiSearch };
