import type { APIRoute } from 'astro';
import { allCities, allCountries } from '../lib/geo/places';

export const prerender = true;

const PAGES = ['/', '/map', '/world', '/rankings', '/rankings?view=clean', '/alerts', '/about', '/methodology', '/privacy'];

/** Cities with real search demand; the rest are still reachable through internal links. */
const SITEMAP_MIN_POPULATION = 250_000;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'https://live-aqi.com/').replace(/\/$/, '');
  const urls: Array<{ loc: string; freq: string; priority: string }> = [
    ...PAGES.map((p) => ({ loc: `${base}${p}`, freq: p === '/' ? 'hourly' : 'daily', priority: p === '/' ? '1.0' : '0.7' })),
    ...allCountries().map((c) => ({ loc: `${base}/country/${c.slug}`, freq: 'hourly', priority: '0.6' })),
    ...allCities()
      .filter((c) => c.population >= SITEMAP_MIN_POPULATION || c.monitored || c.isCapital)
      .map((c) => ({ loc: `${base}/city/${c.slug}`, freq: 'hourly', priority: c.monitored ? '0.8' : '0.5' })),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `<url><loc>${esc(u.loc)}</loc><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
