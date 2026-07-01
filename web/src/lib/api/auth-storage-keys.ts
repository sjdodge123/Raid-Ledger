/**
 * Canonical localStorage/sessionStorage keys for the auth + silent-reauth
 * flow. Centralised (ROK-1367) so the access-token key and the silent-reauth
 * one-shot guard key are defined once — a drifting literal between the code
 * that ARMS the guard and the code that CLEARS it silently breaks the
 * Discord silent re-auth fallback.
 */

/** localStorage key holding the current access token. */
export const ACCESS_TOKEN_KEY = 'raid_ledger_token';

/** localStorage key holding the admin's token while impersonating. */
export const ORIGINAL_TOKEN_KEY = 'raid_ledger_original_token';

/** localStorage key recording how the user last authenticated. */
export const AUTH_METHOD_KEY = 'raid_ledger_auth_method';

/** sessionStorage one-shot guard preventing a silent-reauth redirect loop. */
export const SILENT_GUARD_KEY = 'raid_ledger_silent_attempted';
