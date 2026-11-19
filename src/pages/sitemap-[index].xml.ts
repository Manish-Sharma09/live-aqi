import type { APIRoute, GetStaticPaths } from 'astro';
import { SITEMAP_CHUNK_SIZE, XML_HEADERS, escapeXml, siteBase, sitemapChunkCount, sitemapUrls } from '../lib/sitemap';

export const prerender = true;

/** /sitemap-0.xml, /sitemap-1.xml…: the URL list in chunks of SITEMAP_CHUNK_SIZE. */
export const getStaticPaths = (() =>
  Array.from({ length: sitemapChunkCount() }, (_, i) => ({ params: { index: String(i) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ site, params }) => {
  const base = siteBase(site);
  const n = Number(params.index);
  const urls = sitemapUrls(base).slice(n * SITEMAP_CHUNK_SIZE, (n + 1) * SITEMAP_CHUNK_SIZE);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `<url><loc>${escapeXml(u.loc)}</loc><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: XML_HEADERS });
};
