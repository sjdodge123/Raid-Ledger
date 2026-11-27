/** ROK-2371 D1(a): the `/auth/first-time` page's copy. */
import type { FirstTimeProvider } from './first-time-api';

export const FIRST_TIME_HEADING = 'First time here?';
export const CREATE_LABEL = 'Create a new account';
export const NOT_FOUND_COPY = 'We couldn’t find an account for that one either.';
export const EXPIRED_COPY = 'That sign-in expired. Start again from the login page.';
export const CREATE_FAILED_COPY = 'Couldn’t create your account just now. Try again.';
export const LOAD_FAILED_COPY = 'Couldn’t load this sign-in just now. Check your connection and try again.';

export function providerName(p: FirstTimeProvider): string {
    return p === 'google' ? 'Google' : 'Discord';
}

export function existingLabel(other: FirstTimeProvider): string {
    return `I already have an account — sign in with ${providerName(other)}`;
}

/** The plain message for a `?error=` the pending-link callbacks send back. */
export function firstTimeErrorCopy(error: string | null, provider: FirstTimeProvider, other: FirstTimeProvider): string | null {
    if (error === null || error === '') return null;
    if (error === 'not_found') return NOT_FOUND_COPY;
    if (error === 'taken') {
        return `That ${providerName(provider)} account is already linked to another Raid Ledger account.`;
    }
    if (error === 'already_linked') {
        return `That Raid Ledger account already has a different ${providerName(provider)} account linked. Sign in with ${providerName(other)} and change it from your Profile.`;
    }
    if (error === 'expired') return EXPIRED_COPY;
    return 'That didn’t work. Choose again.';
}
