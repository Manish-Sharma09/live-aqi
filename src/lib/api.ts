/** Small helpers for JSON API routes. */

export function json(body: unknown, init: ResponseInit & { cache?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', init.cache ?? 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status });
}

export function parseCoord(v: string | null, limit: number): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** Same-origin check for state-changing requests. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // non-browser clients / same-origin navigations
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
