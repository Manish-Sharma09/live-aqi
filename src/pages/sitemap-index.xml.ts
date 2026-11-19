import type { APIRoute } from 'astro';
import { XML_HEADERS, escapeXml, siteBase, sitemapChunkCount } from '../lib/sitemap';

export const prerender = true;

/** Sitemap index: lists /sitemap-0.xml (and -1, -2… if the URL list ever outgrows one file). */
export const GET: APIRoute = ({ site }) => {
  const base = siteBase(site);
  const lastmod = new Date().toISOString();
  const entries = Array.from({ length: sitemapChunkCount() }, (_, i) =>
    `<sitemap><loc>${escapeXml(`${base}/sitemap-${i}.xml`)}</loc><lastmod>${lastmod}</lastmod></sitemap>`,
  );
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.join('\n') +
    '\n</sitemapindex>\n';
  return new Response(body, { headers: XML_HEADERS });
};
