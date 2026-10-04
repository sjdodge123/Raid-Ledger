/** Paths a Steam link may return to (ROK-941). Exact match only. */
export const STEAM_RETURN_TO_ALLOWLIST: readonly string[] = [
  '/onboarding',
  '/profile',
];

export const STEAM_RETURN_TO_DEFAULT = '/profile';

/**
 * Validate a Steam-link `returnTo` against the allowlist; anything else
 * (absent, non-string, absolute or protocol-relative URL, unlisted path)
 * becomes the default. Used at nonce mint (POST /auth/steam/link/start), on
 * the GET hop, and when reading the signed OpenID state back (ROK-1630).
 */
export function validateSteamReturnTo(returnTo: unknown): string {
  if (typeof returnTo !== 'string') return STEAM_RETURN_TO_DEFAULT;
  return STEAM_RETURN_TO_ALLOWLIST.includes(returnTo)
    ? returnTo
    : STEAM_RETURN_TO_DEFAULT;
}
