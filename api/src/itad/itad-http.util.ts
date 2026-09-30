/**
 * ITAD API HTTP helpers (ROK-772).
 * Provides typed fetch wrappers with rate limiting and retry backoff.
 *
 * Pacing lives in itad-rate-limit.util: every attempt waits for a slot in one
 * process-wide FIFO, so concurrent callers (early-access sync, IGDB
 * enrichment, search) are spaced by `ITAD_RATE_LIMIT_MS`. A 429 honours the
 * server's `Retry-After` (capped at `ITAD_RETRY_AFTER_MAX_MS`) and pauses the
 * whole queue; without a usable header it falls back to exponential backoff.
 */
import { Logger } from '@nestjs/common';
import {
  ITAD_BASE_URL,
  ITAD_MAX_RETRIES,
  ITAD_BACKOFF_INITIAL_MS,
} from './itad.constants';
import {
  acquireItadSlot,
  parseRetryAfterMs,
  pauseItadRequests,
  sleep,
} from './itad-rate-limit.util';

const logger = new Logger('ItadHttp');

const USER_AGENT =
  'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)';

/** Strip API key from URL for safe logging. */
function redactUrl(url: string): string {
  return url.replace(/key=[^&]+/, 'key=***');
}

/**
 * True for upstream statuses worth retrying: 429 (rate limit) and any 5xx.
 * The 5xx range covers Cloudflare 521/522/524 which prod exports show ITAD
 * returning in bursts at the 4AM sync window (ROK-1103).
 */
function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Exponential-backoff window for the given attempt. */
function backoffMs(attempt: number): number {
  return ITAD_BACKOFF_INITIAL_MS * 2 ** attempt;
}

/** Generic ITAD fetch with rate limiting + 429 backoff */
export async function itadFetch<T>(
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const init: RequestInit = { headers: { 'User-Agent': USER_AGENT } };
  return requestWithRetry<T>(path, buildUrl(path, params), init, 'ITAD');
}

/**
 * ITAD POST request with rate limiting + 429 backoff.
 * Used for batch operations like shop ID lookups.
 * @param path - API path (e.g., '/lookup/shop/61/id/v1')
 * @param params - Query parameters
 * @param body - JSON request body
 */
export async function itadPost<T>(
  path: string,
  params: Record<string, string>,
  body: unknown,
): Promise<T | null> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  return requestWithRetry<T>(path, buildUrl(path, params), init, 'ITAD POST');
}

function buildUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${ITAD_BASE_URL}${path}?${qs}`;
}

interface FetchResult<T> {
  data: T | null;
  retry: boolean;
}

/** Paced attempt loop shared by GET and POST; null after the last retry. */
async function requestWithRetry<T>(
  path: string,
  url: string,
  init: RequestInit,
  label: string,
): Promise<T | null> {
  for (let attempt = 0; attempt <= ITAD_MAX_RETRIES; attempt++) {
    await acquireItadSlot();
    const result = await attemptRequest<T>(url, init, attempt, label);
    if (!result.retry) return result.data;
  }
  logger.warn(
    `${label} request failed after ${ITAD_MAX_RETRIES + 1} attempts: ${path}`,
  );
  return null;
}

/**
 * Wait out a retriable status. A 429 pauses every ITAD caller (the next
 * `acquireItadSlot` absorbs the wait); a 5xx only sleeps this caller.
 */
async function delayRetry(
  response: Response,
  attempt: number,
  label: string,
): Promise<void> {
  const retryAfterMs =
    response.status === 429
      ? parseRetryAfterMs(response.headers.get('retry-after'))
      : null;
  const waitMs = retryAfterMs ?? backoffMs(attempt);
  const source = retryAfterMs === null ? 'backoff' : 'Retry-After';
  logger.warn(
    `${label} ${response.status} — retrying in ${waitMs}ms (${source}, attempt ${attempt + 1})`,
  );
  if (response.status === 429) pauseItadRequests(waitMs);
  else await sleep(waitMs);
}

/** Attempt a single request; retriable statuses and network errors retry. */
async function attemptRequest<T>(
  url: string,
  init: RequestInit,
  attempt: number,
  label: string,
): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, init);
    if (isRetriableStatus(response.status)) {
      await delayRetry(response, attempt, label);
      return { data: null, retry: true };
    }
    if (!response.ok) {
      logger.warn(`${label} HTTP ${response.status}: ${redactUrl(url)}`);
      return { data: null, retry: false };
    }
    return { data: (await response.json()) as T, retry: false };
  } catch (error) {
    logger.warn(
      `${label} network error: ${redactUrl(url)} — retrying in ${backoffMs(attempt)}ms (attempt ${attempt + 1})`,
      error,
    );
    await sleep(backoffMs(attempt));
    return { data: null, retry: true };
  }
}
