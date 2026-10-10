/**
 * ROK-1750 (D5): a private poll's share token survives the Discord sign-in
 * round trip (and onboarding, for a brand-new user) in sessionStorage — the
 * same handoff `invite_code` uses. `invite_code` wins when both are pending.
 */
export const POLL_SHARE_TOKEN_KEY = 'poll_share_token';

/** Remember the share token the visitor opened, before leaving for sign-in. */
export function savePendingPollShare(token: string): void {
    sessionStorage.setItem(POLL_SHARE_TOKEN_KEY, token);
}

/**
 * Take the pending share token (and clear it), returning the share-link path
 * to resume on, or null when none is pending.
 */
export function consumePendingPollShare(): string | null {
    const token = sessionStorage.getItem(POLL_SHARE_TOKEN_KEY);
    sessionStorage.removeItem(POLL_SHARE_TOKEN_KEY);
    return token ? pollSharePath(token) : null;
}

/** The public share-link path for a token. */
export function pollSharePath(token: string): string {
    return `/p/poll/${encodeURIComponent(token)}`;
}

/** The absolute share-link URL for a token (what people copy). */
export function pollShareUrl(token: string): string {
    return `${window.location.origin}${pollSharePath(token)}`;
}
