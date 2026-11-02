/**
 * ROK-1597 (spec §3.5): Graph response → the shared calendar-provider error
 * classes. Reasons are Graph's `error.code` snake-cased
 * (`InvalidAuthenticationToken` → `invalid_authentication_token`) or
 * `http_<status>` — never a body, token, URL or event subject.
 */
import * as microsoftHttp from './microsoft-http';
import type {
  MicrosoftHttpResponse,
  MicrosoftJsonMethod,
  MicrosoftJsonOptions,
} from './microsoft-http';
import { parseRetryAfterMs } from '../google/google-http';
import {
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
  RateLimitError,
  TransientError,
  type CalendarProviderError,
} from '../calendar-provider.errors';

/** Whether the failing call read or wrote (403 means different things). */
export type GraphErrorContext = 'read' | 'write';

const GRAPH_CODE = /^[A-Za-z0-9_]{1,64}$/;

/** Graph's `error.code` when it is a plain identifier, else null. */
export function graphErrorCode(json: unknown): string | null {
  const error = asRecord(asRecord(json).error);
  const code = error.code;
  return typeof code === 'string' && GRAPH_CODE.test(code) ? code : null;
}

/**
 * A read-side 403: the calendar is unreadable and the read loop skips it
 * (7a-2 `readCalendarOrSkip`) instead of failing.
 *
 * Judged by the HTTP status, any body: Graph documents 403 as "Access is
 * denied to the requested resource" but NOT the `ErrorAccessDenied` code for
 * an unshared calendar (ROK-1597 Graph verification, item 5). The code is a
 * secondary hint only — `Authorization_RequestDenied` means the app lacks
 * consent, which must fail the read (scope), not skip one calendar.
 */
export function isGraphAccessDenied(res: MicrosoftHttpResponse): boolean {
  if (res.status !== 403) return false;
  return graphErrorCode(res.json) !== 'Authorization_RequestDenied';
}

/**
 * Map a non-2xx Graph response to the error to throw (spec §3.5 table).
 *
 * @param res - The failed response.
 * @param ctx - `read` keeps a plain 403 as a request refusal (the caller
 *   decides skip via `isGraphAccessDenied`); `write` treats 403 as missing
 *   consent.
 */
export function mapGraphError(
  res: MicrosoftHttpResponse,
  ctx: GraphErrorContext,
): CalendarProviderError {
  const code = graphErrorCode(res.json);
  const reason = code ? snakeCase(code) : `http_${res.status}`;
  const { status } = res;
  if (status === 401) return new ProviderAuthError(reason);
  if (status === 403) return forbidden(code, ctx, reason);
  if (status === 404 || status === 410) return new NotFoundError(reason);
  if (
    status === 429 ||
    ((status === 503 || status === 504) && res.retryAfter)
  ) {
    return new RateLimitError(parseRetryAfterMs(res.retryAfter), reason);
  }
  if (status >= 500) return new TransientError(reason);
  return new ProviderRequestError(reason);
}

/** Throw the mapped error unless the response is 2xx. */
export function assertGraphOk(
  res: MicrosoftHttpResponse,
  ctx: GraphErrorContext,
): void {
  if (res.status >= 200 && res.status < 300) return;
  throw mapGraphError(res, ctx);
}

/** A fetch rejection (DNS, reset, abort timeout) → `TransientError`. */
export function graphNetworkError(err: unknown): TransientError {
  const timedOut = err instanceof Error && err.name === 'TimeoutError';
  return new TransientError(timedOut ? 'timeout' : 'network');
}

/**
 * Call Graph through the spied seam; a network failure becomes a
 * `TransientError`. Status mapping is left to the caller.
 */
export async function graphRequest(
  method: MicrosoftJsonMethod,
  url: string,
  accessToken: string,
  body?: unknown,
  opts: MicrosoftJsonOptions = {},
): Promise<MicrosoftHttpResponse> {
  try {
    return await microsoftHttp.microsoftJsonRequest(
      method,
      url,
      accessToken,
      body,
      opts,
    );
  } catch (err) {
    throw graphNetworkError(err);
  }
}

function forbidden(
  code: string | null,
  ctx: GraphErrorContext,
  reason: string,
): CalendarProviderError {
  if (ctx === 'write' || code === 'Authorization_RequestDenied') {
    return new ProviderAuthError('scope');
  }
  return new ProviderRequestError(reason);
}

function snakeCase(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/__+/g, '_')
    .toLowerCase()
    .slice(0, 48);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}
