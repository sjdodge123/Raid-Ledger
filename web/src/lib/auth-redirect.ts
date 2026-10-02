const AUTH_REDIRECT_KEY = 'authRedirect';
const AUTH_REDIRECT_SAVED_AT_KEY = 'authRedirectSavedAt';

/**
 * How long a saved post-sign-in destination stays usable.
 *
 * A UX choice: a deep link saved before a sign-in that the user abandons
 * should not hijack an unrelated sign-in much later in the same tab. It is
 * deliberately NOT coupled to the magic-link token lifetime; change either
 * independently.
 */
export const AUTH_REDIRECT_TTL_MS = 15 * 60 * 1000;

/**
 * Save the intended destination for post-login redirect.
 * The path is stored raw; its save time goes in a sibling key.
 */
export function saveAuthRedirect(path: string): void {
    sessionStorage.setItem(AUTH_REDIRECT_KEY, path);
    sessionStorage.setItem(AUTH_REDIRECT_SAVED_AT_KEY, String(Date.now()));
}

/**
 * Get and clear the saved auth redirect.
 * Both keys are always removed. Returns null when nothing is saved or the
 * entry is expired: a missing, unparseable, future-dated or older-than-TTL
 * save time all count as expired.
 */
export function consumeAuthRedirect(): string | null {
    const redirect: string | null = sessionStorage.getItem(AUTH_REDIRECT_KEY);
    const savedAtRaw: string | null = sessionStorage.getItem(AUTH_REDIRECT_SAVED_AT_KEY);
    sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    sessionStorage.removeItem(AUTH_REDIRECT_SAVED_AT_KEY);
    if (!redirect || savedAtRaw === null) return null;
    const savedAt = Number(savedAtRaw);
    if (!Number.isFinite(savedAt)) return null;
    const age = Date.now() - savedAt;
    return age >= 0 && age <= AUTH_REDIRECT_TTL_MS ? redirect : null;
}
