import type { Logger } from '@nestjs/common';
import { validateSteamAssertion } from './steam-openid-assertion.helpers';
import type { SteamOpenIdNonceStore } from './steam-openid-nonce.store';

/** The one user-facing message for every rejected assertion (no oracle). */
export const STEAM_VERIFICATION_FAILED = 'Steam verification failed';

/** Null when the nonce is fresh; otherwise why it cannot be used. */
async function claimNonce(
  store: SteamOpenIdNonceStore,
  nonce: string,
): Promise<string | null> {
  try {
    return (await store.claim(nonce)) ? null : 'replayed response_nonce';
  } catch (err) {
    // Fail closed: a store outage must not silently drop the replay guard.
    const msg = err instanceof Error ? err.message : String(err);
    return `nonce store error: ${msg}`;
  }
}

/**
 * ROK-1731: validate a Steam OpenID callback locally, then burn its
 * response_nonce — BEFORE Steam is contacted (spec D2). Every failure logs
 * its specific reason and throws one generic error (spec D3).
 * @param callbackUrl `${apiBase}/auth/steam/link/callback`, no query
 */
export async function assertFreshSteamAssertion(
  query: Record<string, string>,
  callbackUrl: string,
  deps: { nonceStore: SteamOpenIdNonceStore; logger: Logger },
): Promise<void> {
  const check = validateSteamAssertion(query, callbackUrl, query.state);
  const reason = check.ok
    ? await claimNonce(deps.nonceStore, check.nonce)
    : check.reason;
  if (!reason) return;
  deps.logger.warn(`Steam OpenID assertion rejected: ${reason}`);
  throw new Error(STEAM_VERIFICATION_FAILED);
}
