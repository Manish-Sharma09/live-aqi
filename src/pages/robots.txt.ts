import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'https://live-aqi.com/').replace(/\/$/, '');
  const body = ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
