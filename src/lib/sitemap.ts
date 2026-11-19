/**
 * Sitemap URL list, shared by /sitemap-index.xml and its /sitemap-<n>.xml chunks
 * (the same file layout @astrojs/sitemap produces).
 */
import { CONTINENTS, allCities, allCountries } from './geo/places';
import { POPULAR_CITIES } from './seo';

/** Continent rankings ("most polluted cities in Asia"); same query order as the page's canonical URL. */
const CONTINENT_RANKINGS = Object.keys(CONTINENTS)
  .filter((c) => c !== 'AN')
  .flatMap((c) => [`/rankings?region=${c}`, `/rankings?view=clean&region=${c}`]);
const PAGES = [
  '/',
  '/what-is-aqi',
  '/map',
  '/world',
  '/rankings',
  '/rankings?view=clean',
  ...CONTINENT_RANKINGS,
  '/alerts',
  '/about',
  '/methodology',
  '/contact',
  '/privacy',
  '/terms',
];

/** Cities with real search demand; the rest are still reachable through internal links. */
const SITEMAP_MIN_POPULATION = 250_000;
/** Cities people search "<city> aqi" for (Google Trends), listed whatever their size. */
const POPULAR = new Set(POPULAR_CITIES.map((c) => c.slug));

/** URLs per sitemap file; the protocol allows 50,000. */
export const SITEMAP_CHUNK_SIZE = 45_000;

export interface SitemapUrl {
  loc: string;
  freq: string;
  priority: string;
}

export function siteBase(site: URL | undefined): string {
  return (site?.href ?? 'https://live-aqi.com/').replace(/\/$/, '');
}

export function sitemapUrls(base: string): SitemapUrl[] {
  return [
    ...PAGES.map((p) => ({ loc: `${base}${p}`, freq: p === '/' ? 'hourly' : 'daily', priority: p === '/' ? '1.0' : '0.7' })),
    ...allCountries().map((c) => ({ loc: `${base}/country/${c.slug}`, freq: 'hourly', priority: '0.6' })),
    ...allCities()
      .filter((c) => c.population >= SITEMAP_MIN_POPULATION || c.monitored || c.isCapital || POPULAR.has(c.slug))
      .map((c) => ({ loc: `${base}/city/${c.slug}`, freq: 'hourly', priority: c.monitored || POPULAR.has(c.slug) ? '0.8' : '0.5' })),
  ];
}

/** Number of /sitemap-<n>.xml files (at least one). */
export function sitemapChunkCount(): number {
  return Math.max(1, Math.ceil(sitemapUrls('').length / SITEMAP_CHUNK_SIZE));
}

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const XML_HEADERS = { 'content-type': 'application/xml; charset=utf-8' } as const;
