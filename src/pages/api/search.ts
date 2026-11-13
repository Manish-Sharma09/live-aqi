import type { APIRoute } from 'astro';
import { error, json } from '../../lib/api';
import { searchPlaces } from '../../lib/services/search';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return json({ results: [] });
  if (q.length > 80) return error(400, 'Query too long');
  try {
    const results = await searchPlaces(q);
    return json({ query: q, results }, { cache: 'public, max-age=300' });
  } catch (err) {
    console.error('[api/search]', err);
    return error(502, 'Search is temporarily unavailable');
  }
};
