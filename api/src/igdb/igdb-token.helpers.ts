/**
 * Token management helpers for IGDB/Twitch API access (ROK-773).
 * Extracted from IgdbService to stay under 300-line limit.
 */
import { fetchTwitchToken } from './igdb-api.helpers';

/** In-memory token state for IGDB API access. */
export interface TokenState {
  accessToken: string | null;
  tokenExpiry: Date | null;
  tokenFetchPromise: Promise<string> | null;
}

/** Create initial token state. */
export function createTokenState(): TokenState {
  return {
    accessToken: null,
    tokenExpiry: null,
    tokenFetchPromise: null,
  };
}

/** Clear stored token (e.g., after 401). */
export function clearToken(state: TokenState): void {
  state.accessToken = null;
  state.tokenExpiry = null;
  state.tokenFetchPromise = null;
}

/**
 * Get a valid access token, fetching a new one if needed.
 * @param state - Mutable token state
 * @param getCredentials - Callback to resolve client credentials
 * @returns Access token string
 */
export async function getAccessToken(
  state: TokenState,
  getCredentials: () => Promise<{ clientId: string; clientSecret: string }>,
): Promise<string> {
  if (
    state.accessToken &&
    state.tokenExpiry &&
    new Date() < state.tokenExpiry
  ) {
    return state.accessToken;
  }
  if (state.tokenFetchPromise) return state.tokenFetchPromise;
  state.tokenFetchPromise = fetchNewToken(state, getCredentials);
  try {
    return await state.tokenFetchPromise;
  } finally {
    state.tokenFetchPromise = null;
  }
}

/** Fetch a new token from Twitch. */
async function fetchNewToken(
  state: TokenState,
  getCredentials: () => Promise<{ clientId: string; clientSecret: string }>,
): Promise<string> {
  const { clientId, clientSecret } = await getCredentials();
  const { token, expiry } = await fetchTwitchToken(clientId, clientSecret);
  state.accessToken = token;
  state.tokenExpiry = expiry;
  return token;
}
