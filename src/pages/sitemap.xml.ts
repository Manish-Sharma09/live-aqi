import type { APIRoute } from 'astro';

export const prerender = false;

/** The sitemap moved to /sitemap-index.xml; keep the common default path working for crawlers and tools. */
export const GET: APIRoute = ({ redirect }) => redirect('/sitemap-index.xml', 301);
