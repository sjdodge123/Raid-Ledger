/**
 * Canonical localStorage/sessionStorage keys for the auth + silent-reauth
 * flow. Centralised (ROK-1367) so the access-token key and the silent-reauth
 * one-shot guard key are defined once — a drifting literal between the code
 * that ARMS the guard and the code that CLEARS it silently breaks the
 * Discord silent re-auth fallback.
 */

/**
 * PURGE-ONLY (ROK-1754): the access token used to live here. It is now held
 * in memory only (`access-token-store.ts`); this key is read once at boot to
 * remove what an older bundle left behind. Never write it.
 */
export const LEGACY_ACCESS_TOKEN_KEY = 'raid_ledger_token';

/** PURGE-ONLY (ROK-1754): the admin JWT an older bundle kept while impersonating. */
export const LEGACY_ORIGINAL_TOKEN_KEY = 'raid_ledger_original_token';

/** localStorage key recording how the user last authenticated. */
export const AUTH_METHOD_KEY = 'raid_ledger_auth_method';

/** sessionStorage one-shot guard preventing a silent-reauth redirect loop. */
export const SILENT_GUARD_KEY = 'raid_ledger_silent_attempted';

/** localStorage key caching the last /auth/me user for instant boot. */
export const USER_CACHE_KEY = 'raid_ledger_user_cache';
