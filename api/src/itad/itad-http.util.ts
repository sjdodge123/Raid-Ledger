/**
 * ITAD API HTTP helpers (ROK-772).
 * Provides typed fetch wrappers with rate limiting and exponential backoff.
 */
import { Logger } from '@nestjs/common';
import {
  ITAD_BASE_URL,
  ITAD_RATE_LIMIT_MS,
  ITAD_MAX_RETRIES,
  ITAD_BACKOFF_INITIAL_MS,
} from './itad.constants';

const logger = new Logger('ItadHttp');

const USER_AGENT =
  'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)';

/** Strip API key from URL for safe logging. */
function redactUrl(url: string): string {
  return url.replace(/key=[^&]+/, 'key=***');
}

/** Timestamp of the last ITAD API call for rate limiting */
let lastCallAt = 0;

/** Wait for rate-limit window if needed */
async function enforceRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < ITAD_RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, ITAD_RATE_LIMIT_MS - elapsed));
  }
  lastCallAt = Date.now();
}

/** Generic ITAD fetch with rate limiting + 429 backoff */
export async function itadFetch<T>(
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const url = buildUrl(path, params);

  for (let attempt = 0; attempt <= ITAD_MAX_RETRIES; attempt++) {
    await enforceRateLimit();
    const result = await attemptFetch<T>(url, attempt);
    if (result.retry) continue;
    return result.data;
  }

  logger.warn(
    `ITAD request failed after ${ITAD_MAX_RETRIES + 1} attempts: ${path}`,
  );
  return null;
}

function buildUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${ITAD_BASE_URL}${path}?${qs}`;
}

interface FetchResult<T> {
  data: T | null;
  retry: boolean;
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
  const url = buildUrl(path, params);

  for (let attempt = 0; attempt <= ITAD_MAX_RETRIES; attempt++) {
    await enforceRateLimit();
    const result = await attemptPost<T>(url, body, attempt);
    if (result.retry) continue;
    return result.data;
  }

  logger.warn(
    `ITAD POST failed after ${ITAD_MAX_RETRIES + 1} attempts: ${path}`,
  );
  return null;
}

/** Build POST fetch options. */
function buildPostOptions(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Attempt a single POST request. */
async function attemptPost<T>(
  url: string,
  body: unknown,
  attempt: number,
): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, buildPostOptions(body));
    if (response.status === 429) {
      const backoff = ITAD_BACKOFF_INITIAL_MS * 2 ** attempt;
      logger.warn(
        `ITAD POST 429 — retrying in ${backoff}ms (attempt ${attempt + 1})`,
      );
      await new Promise((r) => setTimeout(r, backoff));
      return { data: null, retry: true };
    }
    if (!response.ok) {
      logger.warn(`ITAD POST HTTP ${response.status}: ${redactUrl(url)}`);
      return { data: null, retry: false };
    }
    return { data: (await response.json()) as T, retry: false };
  } catch (error) {
    logger.error(`ITAD POST fetch error: ${redactUrl(url)}`, error);
    return { data: null, retry: false };
  }
}

async function attemptFetch<T>(
  url: string,
  attempt: number,
): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (response.status === 429) {
      const backoff = ITAD_BACKOFF_INITIAL_MS * 2 ** attempt;
      logger.warn(
        `ITAD 429 — retrying in ${backoff}ms (attempt ${attempt + 1})`,
      );
      await new Promise((r) => setTimeout(r, backoff));
      return { data: null, retry: true };
    }

    if (!response.ok) {
      logger.warn(`ITAD HTTP ${response.status}: ${redactUrl(url)}`);
      return { data: null, retry: false };
    }

    return { data: (await response.json()) as T, retry: false };
  } catch (error) {
    logger.error(`ITAD fetch error: ${redactUrl(url)}`, error);
    return { data: null, retry: false };
  }
}
