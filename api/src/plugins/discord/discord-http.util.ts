import { Logger } from '@nestjs/common';

const logger = new Logger('DiscordHTTP');

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

export interface DiscordFetchOptions {
  maxRetries?: number;
}

/**
 * Wrapper around `fetch()` that retries on Discord 429 responses.
 *
 * - Parses `Retry-After` header (Discord sends seconds)
 * - Falls back to exponential backoff (1s, 2s, 4s)
 * - Logs warnings on retry, errors on exhaustion
 */
export async function discordFetch(
  url: string | URL,
  init?: RequestInit,
  options?: DiscordFetchOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);

    if (response.status !== 429) {
      return response;
    }

    // Last attempt — don't retry, return the 429
    if (attempt === maxRetries) {
      logger.error(
        `Discord API rate limit exhausted after ${maxRetries} retries: ${String(url)}`,
      );
      return response;
    }

    // Determine wait time from headers or exponential backoff
    const retryAfterHeader =
      response.headers.get('retry-after') ??
      response.headers.get('x-ratelimit-reset-after');

    const waitMs = retryAfterHeader
      ? Math.ceil(parseFloat(retryAfterHeader) * 1_000)
      : BASE_BACKOFF_MS * Math.pow(2, attempt);

    logger.warn(
      `Discord 429 on ${String(url)} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`,
    );

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // Unreachable but satisfies TypeScript
  throw new Error('discordFetch: unexpected loop exit');
}
