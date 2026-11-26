/**
 * ROK-2370: the pending sign-in code's sessionStorage key and its eraser, in a
 * leaf module. `use-auth` forgets a pending code on every sign-in and
 * sign-out; importing it from `signin-code.ts` dragged the code's fetch
 * helpers and contract schemas into the eager auth chunk (bundle budget).
 */
import { safeSessionRemoveItem } from './safe-storage';

/** sessionStorage key for the pending code (tab-scoped, survives reload). */
export const SIGNIN_CODE_STORAGE_KEY = 'rl_signin_code';

/** Forget the pending code (cancel, close, expiry, success, sign-in, sign-out). */
export function clearPendingSigninCode(): void {
    safeSessionRemoveItem(SIGNIN_CODE_STORAGE_KEY);
}
