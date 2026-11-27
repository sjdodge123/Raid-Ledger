/**
 * ROK-2371: the "last way to sign in" rule the Profile unlink buttons mirror.
 * The server enforces it (409 `LAST_SIGNIN_METHOD` on both unlink routes);
 * this only decides when a button is disabled before the user presses it.
 */
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf } from '../../lib/api/api-error';

export type UnlinkableMethod = 'discord' | 'google';

/** The server's 409 copy, shown under a disabled Unlink and on a refused unlink. */
export const LAST_SIGNIN_METHOD_COPY = 'Add another way to sign in first';

function countMethods(methods: SigninMethodsDto): number {
    return Number(methods.discord) + Number(methods.google !== null) + Number(methods.password);
}

function hasMethod(methods: SigninMethodsDto, method: UnlinkableMethod): boolean {
    return method === 'discord' ? methods.discord : methods.google !== null;
}

/** True when `method` is linked and is the only way the user can sign in. */
export function isLastSigninMethod(methods: SigninMethodsDto | undefined, method: UnlinkableMethod): boolean {
    if (!methods) return false;
    return hasMethod(methods, method) && countMethods(methods) <= 1;
}

/** A refused unlink: HTTP 409 with `code: 'LAST_SIGNIN_METHOD'`. */
export function isLastSigninMethodError(err: unknown): boolean {
    return httpStatusOf(err) === 409 && errorBodyOf(err)?.code === 'LAST_SIGNIN_METHOD';
}

/** The inline message for a failed unlink. */
export function unlinkErrorMessage(err: unknown): string {
    if (isLastSigninMethodError(err)) return LAST_SIGNIN_METHOD_COPY;
    return err instanceof Error && err.message ? err.message : 'Could not unlink. Please try again.';
}

/** ROK-2371: a Google-created (or Google-only) account without a linked Discord. */
export function needsDiscordNudge(methods: SigninMethodsDto | undefined): boolean {
    return !!methods && !methods.discord && methods.google !== null;
}
