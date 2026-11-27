/**
 * The toast for an OAuth refusal that lands on `/login?error=…[&reason=…]`.
 * Discord and Google sign-in share the params (ROK-313 AC4, ROK-2371):
 * `reason` carries the server-authored ban / kick-cooldown copy for
 * `suspended` only, capped at {@link MAX_REASON_LENGTH} because a crafted URL
 * can set it; every other code shows fixed copy.
 */
export const OAUTH_FAILED_MESSAGE = 'Login failed. Please try again.';
export const SUSPENDED_MESSAGE = 'Your account has been suspended.';
/** ROK-2371 §3: Google sign-in refuses a deactivated account with this copy. */
export const GOOGLE_DEACTIVATED_MESSAGE =
    'Your account was deactivated when you left the Discord server. Rejoin it, then sign in with Discord.';
const MAX_REASON_LENGTH = 300;
/** ROK-2371 §3: an unknown Google account whose email Google has not verified. */
export const GOOGLE_UNVERIFIED_MESSAGE =
    'Google has not verified the email on that account, so it cannot be used to sign in.';

/** The message to toast, or null when `error` is not a sign-in refusal. */
export function oauthErrorMessage(error: string | null, reason: string | null): string | null {
    switch (error) {
        case 'oauth_failed':
            return OAUTH_FAILED_MESSAGE;
        case 'suspended':
            return reason ? reason.slice(0, MAX_REASON_LENGTH) : SUSPENDED_MESSAGE;
        case 'deactivated':
            return GOOGLE_DEACTIVATED_MESSAGE;
        case 'google_unverified':
            return GOOGLE_UNVERIFIED_MESSAGE;
        default:
            return null;
    }
}
