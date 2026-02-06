const AUTH_REDIRECT_KEY = 'authRedirect';

/**
 * Save the intended destination for post-login redirect.
 */
export function saveAuthRedirect(path: string): void {
    sessionStorage.setItem(AUTH_REDIRECT_KEY, path);
}

/**
 * Get and clear the saved auth redirect.
 */
export function consumeAuthRedirect(): string | null {
    const redirect = sessionStorage.getItem(AUTH_REDIRECT_KEY);
    if (redirect) {
        sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    }
    return redirect;
}
