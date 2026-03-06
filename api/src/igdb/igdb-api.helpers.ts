import { Logger } from '@nestjs/common';
import {
  IGDB_CONFIG,
  ADULT_THEME_IDS,
  type IgdbApiGame,
} from './igdb.constants';

const logger = new Logger('IgdbApiHelpers');

/** Delay helper for retry logic. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse token response body into token + expiry. */
function parseTokenResponse(data: {
  access_token: string;
  expires_in: number;
}): { token: string; expiry: Date } {
  const expiry = new Date(
    Date.now() + (data.expires_in - IGDB_CONFIG.TOKEN_EXPIRY_BUFFER) * 1000,
  );
  return { token: data.access_token, expiry };
}

/**
 * Fetch a new OAuth2 token from Twitch.
 * @param clientId - Twitch Client ID
 * @param clientSecret - Twitch Client Secret
 * @returns Token string and expiry date
 */
export async function fetchTwitchToken(
  clientId: string,
  clientSecret: string,
): Promise<{ token: string; expiry: Date }> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      `Failed to get IGDB access token: ${response.status} ${errorText}`,
    );
    throw new Error(`Failed to get IGDB access token: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  logger.debug('IGDB access token refreshed');
  return parseTokenResponse(data);
}

/** Build IGDB search query body string. */
function buildSearchBody(query: string, adultFilterEnabled: boolean): string {
  const sanitizedQuery = query.replace(/"/g, '\\"');
  const adultWhereClause = adultFilterEnabled
    ? ` where themes != (${ADULT_THEME_IDS.join(',')});`
    : '';
  return `search "${sanitizedQuery}"; fields ${IGDB_CONFIG.EXPANDED_FIELDS};${adultWhereClause} limit ${IGDB_CONFIG.SEARCH_LIMIT};`;
}

/**
 * Fetch games from IGDB API.
 * @param query - Normalized search query
 * @param adultFilterEnabled - Whether adult filter is active
 * @param clientId - Twitch Client ID
 * @param token - OAuth2 access token
 * @returns Array of IGDB API game objects
 */
export async function fetchFromIgdb(
  query: string,
  adultFilterEnabled: boolean,
  clientId: string,
  token: string,
): Promise<IgdbApiGame[]> {
  const body = buildSearchBody(query, adultFilterEnabled);
  logger.debug(`IGDB search query: ${body}`);

  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`IGDB API error: ${response.status} ${errorText}`);
    throw new Error(
      `IGDB API error ${response.status}: ${response.statusText}`,
    );
  }

  const results = (await response.json()) as IgdbApiGame[];
  logger.debug(`IGDB search returned ${results.length} results for "${query}"`);
  return results;
}

/** Handle retry logic for a specific error type. */
function shouldRetry(
  errorMsg: string,
  attempt: number,
  retriedAuth: boolean,
): 'auth' | 'rate' | 'none' {
  if (errorMsg.includes('401') && !retriedAuth) return 'auth';
  if (errorMsg.includes('429') && attempt < IGDB_CONFIG.MAX_RETRIES)
    return 'rate';
  return 'none';
}

/**
 * Fetch games from IGDB with retry logic for rate limiting (429).
 * Uses exponential backoff: 1s, 2s, 4s delays.
 * @param fetcher - Function that performs the actual fetch
 * @param clearToken - Function to clear the cached token on 401
 * @param attempt - Current retry attempt
 * @param retriedAuth - Whether a 401 retry has been attempted
 * @returns Array of IGDB API game objects
 */
export async function fetchWithRetry(
  fetcher: () => Promise<IgdbApiGame[]>,
  clearToken: () => void,
  attempt = 1,
  retriedAuth = false,
): Promise<IgdbApiGame[]> {
  try {
    return await fetcher();
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const action = shouldRetry(errorMsg, attempt, retriedAuth);

    if (action === 'auth') {
      logger.warn('IGDB 401 Unauthorized -- clearing token and retrying');
      clearToken();
      return fetchWithRetry(fetcher, clearToken, attempt, true);
    }

    if (action === 'rate') {
      const retryDelay =
        Math.pow(2, attempt - 1) * IGDB_CONFIG.BASE_RETRY_DELAY;
      logger.warn(`IGDB 429 rate limit, retrying in ${retryDelay}ms`);
      await delay(retryDelay);
      return fetchWithRetry(fetcher, clearToken, attempt + 1, retriedAuth);
    }

    if (errorMsg.includes('429')) {
      logger.error(`IGDB rate limit: max retries exhausted`);
    }
    throw error;
  }
}
