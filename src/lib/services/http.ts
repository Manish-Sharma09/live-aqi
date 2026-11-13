export type UpstreamErrorKind = 'timeout' | 'rate-limit' | 'http' | 'network' | 'invalid';

export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a JSON document with a timeout, one retry on transient failures, and
 * typed errors. Rate limits (429) are never retried.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 9000, retries = 1, headers } = opts;
  let lastError: UpstreamError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'LiveAQI/1.0 (+https://live-aqi.com)', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
      lastError = new UpstreamError(isTimeout ? 'timeout' : 'network', isTimeout ? 'Upstream request timed out' : 'Network error');
      continue;
    }
    if (res.status === 429) throw new UpstreamError('rate-limit', 'Upstream rate limit reached', 429);
    if (res.status >= 500) {
      lastError = new UpstreamError('http', `Upstream error ${res.status}`, res.status);
      continue;
    }
    if (!res.ok) {
      let reason = `Upstream error ${res.status}`;
      try {
        const body = (await res.json()) as { reason?: string };
        if (body?.reason) reason = body.reason;
      } catch {
        /* ignore non-JSON error bodies */
      }
      throw new UpstreamError('http', reason, res.status);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new UpstreamError('invalid', 'Upstream returned invalid JSON', res.status);
    }
  }
  throw lastError ?? new UpstreamError('network', 'Request failed');
}

export function describeError(err: unknown): string {
  if (err instanceof UpstreamError) {
    switch (err.kind) {
      case 'timeout':
        return 'The air-quality provider took too long to respond.';
      case 'rate-limit':
        return 'The air-quality provider is temporarily rate-limiting requests.';
      case 'network':
        return 'The air-quality provider could not be reached.';
      default:
        return 'The air-quality provider returned an error.';
    }
  }
  return 'Something went wrong while loading air-quality data.';
}
