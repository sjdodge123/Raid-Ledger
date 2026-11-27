/**
 * The toast for an OAuth refusal that lands on `/login?error=…[&reason=…]`.
 * Discord and Google sign-in share the params (ROK-313 AC4, ROK-2371):
 * `reason` carries the server-authored copy (ban reason, kick cooldown, the
 * Google deactivated copy); each code falls back to a fixed message.
 */
import { DEACTIVATED_MESSAGE } from '../../lib/api/deactivated-session';

export const OAUTH_FAILED_MESSAGE = 'Login failed. Please try again.';
export const SUSPENDED_MESSAGE = 'Your account has been suspended.';
/** ROK-2371 §3: an unknown Google account whose email Google has not verified. */
export const GOOGLE_UNVERIFIED_MESSAGE =
    'Google has not verified the email on that account, so it cannot be used to sign in.';

/** The message to toast, or null when `error` is not a sign-in refusal. */
export function oauthErrorMessage(error: string | null, reason: string | null): string | null {
    switch (error) {
        case 'oauth_failed':
            return OAUTH_FAILED_MESSAGE;
        case 'suspended':
            return reason || SUSPENDED_MESSAGE;
        case 'deactivated':
            return reason || DEACTIVATED_MESSAGE;
        case 'google_unverified':
            return GOOGLE_UNVERIFIED_MESSAGE;
        default:
            return null;
    }
}
