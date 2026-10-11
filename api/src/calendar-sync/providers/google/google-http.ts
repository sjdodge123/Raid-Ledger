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
 * rejection; the OAuth and write helpers map them to `TransientError`.
 * Nothing here logs: forms and headers carry codes, tokens and the client
 * secret, and JSON bodies carry event titles (ROK-1596).
 */

/** Default per-request timeout for every Google call. */
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
  return readResponse(res);
}

/** HTTP methods the Calendar API write helpers use (ROK-1596). */
export type GoogleJsonMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * ROK-1596: call a Google REST endpoint with a bearer token and an optional
 * JSON body, and read the JSON reply (an empty 204 reads as `json: null`).
 *
 * @param url - Full Calendar API URL, ids already encoded.
 * @param accessToken - OAuth access token (never logged).
 * @param body - Serialised as JSON when present.
 * @param opts.timeoutMs - Abort after this long (default 10 s).
 */
export async function googleJsonRequest(
  method: GoogleJsonMethod,
  url: string,
  accessToken: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<GoogleHttpResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? GOOGLE_HTTP_TIMEOUT_MS),
  });
  return readResponse(res);
}

/** Fallback wait when a 429 carries no usable `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

/** `Retry-After` (delta seconds or an HTTP date) → milliseconds to wait. */
export function parseRetryAfterMs(raw: string | null, nowMs = Date.now()) {
  if (!raw) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, at - nowMs);
}

async function readResponse(res: Response): Promise<GoogleHttpResponse> {
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
