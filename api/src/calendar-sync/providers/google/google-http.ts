/**
 * ROK-1592: the one HTTP seam for Google OAuth calls (plan L14, Q6 —
 * hand-rolled, no SDK).
 *
 * Callers import this module as a namespace (`import * as googleHttp`) so a
 * spec can `jest.spyOn(googleHttp, 'googleFormPost')` and intercept it in a
 * unit spec AND in the singleton integration app, where `jest.mock` arrives
 * too late (precedent: `steam/steam-auth.integration.spec.ts`).
 *
 * Network failures (DNS, reset, the abort timeout) propagate as the fetch
 * rejection; the OAuth helpers map them to `TransientError`. Nothing here
 * logs: the form carries codes, tokens and the client secret.
 */

/** Default per-request timeout for the token and revoke endpoints. */
export const GOOGLE_HTTP_TIMEOUT_MS = 10_000;

/** What callers see of a Google response. */
export interface GoogleHttpResponse {
  status: number;
  /** Parsed JSON body, or null when the body is empty or not JSON. */
  json: unknown;
  /** Raw `Retry-After` header (seconds or HTTP date), when present. */
  retryAfter: string | null;
}

/**
 * POST an `application/x-www-form-urlencoded` body and read the JSON reply.
 *
 * @param url - Google endpoint (token or revoke).
 * @param form - Form fields; values are URL-encoded here.
 * @param opts.timeoutMs - Abort after this long (default 10 s).
 */
export async function googleFormPost(
  url: string,
  form: Record<string, string>,
  opts: { timeoutMs?: number } = {},
): Promise<GoogleHttpResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(opts.timeoutMs ?? GOOGLE_HTTP_TIMEOUT_MS),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: parseJson(text),
    retryAfter: res.headers.get('retry-after'),
  };
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
