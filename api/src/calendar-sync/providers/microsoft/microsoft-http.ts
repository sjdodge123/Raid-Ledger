/**
 * ROK-1597: the one HTTP seam for Microsoft identity platform + Graph calls
 * (hand-rolled, no MSAL / Graph SDK — same ruling as Google, ROK-669 Q6).
 *
 * Callers import this module as a namespace (`import * as microsoftHttp`) so
 * a spec can `jest.spyOn(microsoftHttp, 'microsoftFormPost')` /
 * `'microsoftJsonRequest'` in a unit spec AND in the singleton integration
 * app, where `jest.mock` arrives too late.
 *
 * Network failures (DNS, reset, the abort timeout) propagate as the fetch
 * rejection; `microsoft-graph-errors.helpers` maps them to `TransientError`.
 * Nothing here logs: forms and headers carry codes, tokens and the client
 * secret, and JSON bodies carry event titles.
 */

/** Default per-request timeout for every Microsoft call. */
export const MICROSOFT_HTTP_TIMEOUT_MS = 10_000;

/** What callers see of a Microsoft response. */
export interface MicrosoftHttpResponse {
  status: number;
  /** Parsed JSON body, or null when the body is empty or not JSON. */
  json: unknown;
  /** Raw `Retry-After` header (Graph sends seconds), when present. */
  retryAfter: string | null;
}

/** HTTP methods the Graph helpers use. */
export type MicrosoftJsonMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Options for a Graph JSON call. */
export interface MicrosoftJsonOptions {
  timeoutMs?: number;
  /** `Prefer` values, joined with `, ` into one header. */
  prefer?: readonly string[];
}

/**
 * POST an `application/x-www-form-urlencoded` body and read the JSON reply.
 *
 * @param url - The v2.0 token endpoint.
 * @param form - Form fields; values are URL-encoded here.
 * @param opts.timeoutMs - Abort after this long (default 10 s).
 */
export async function microsoftFormPost(
  url: string,
  form: Record<string, string>,
  opts: { timeoutMs?: number } = {},
): Promise<MicrosoftHttpResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(opts.timeoutMs ?? MICROSOFT_HTTP_TIMEOUT_MS),
  });
  return readResponse(res);
}

/**
 * Call a Graph endpoint with a bearer token and an optional JSON body, and
 * read the JSON reply (an empty 204 reads as `json: null`).
 *
 * @param url - Full Graph URL, ids already encoded.
 * @param accessToken - OAuth access token (never logged).
 * @param body - Serialised as JSON when present.
 * @param opts - Timeout (default 10 s) and `Prefer` header values.
 */
export async function microsoftJsonRequest(
  method: MicrosoftJsonMethod,
  url: string,
  accessToken: string,
  body?: unknown,
  opts: MicrosoftJsonOptions = {},
): Promise<MicrosoftHttpResponse> {
  const res = await fetch(url, {
    method,
    headers: jsonHeaders(accessToken, body !== undefined, opts.prefer),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? MICROSOFT_HTTP_TIMEOUT_MS),
  });
  return readResponse(res);
}

/** Headers for a Graph JSON call; exported for the header spec. */
export function jsonHeaders(
  accessToken: string,
  hasBody: boolean,
  prefer: readonly string[] = [],
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (prefer.length > 0) headers.Prefer = prefer.join(', ');
  return headers;
}

async function readResponse(res: Response): Promise<MicrosoftHttpResponse> {
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
