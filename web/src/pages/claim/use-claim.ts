/**
 * `POST /setup/claim` mutation + coded-error mapping (ROK-1701).
 *
 * Uses `nativeFetch` like the local sign-in: a 401 here means "wrong code",
 * not "session expired", so it must bypass the silent re-auth interceptor.
 * The code travels only in the JSON body — never a URL, never a log.
 */
import { useCallback, useState } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { SetupClaimRequestDto } from '@raid-ledger/contract';
import { useAuth } from '../../hooks/use-auth';
import { API_BASE_URL } from '../../lib/config';
import { nativeFetch } from '../../lib/api/native-fetch';
import { clearSilentGuard, setAuthMethod } from '../../lib/api/silent-reauth';
import type { ClaimFailure } from './claim.helpers';

/** A refused claim, carrying only the mapped failure (no code, no password). */
export class ClaimRequestError extends Error {
    readonly failure: ClaimFailure;

    constructor(failure: ClaimFailure) {
        super(`setup claim refused: ${failure.kind}`);
        this.name = 'ClaimRequestError';
        this.failure = failure;
    }
}

function bodyCode(body: unknown): { code?: unknown; retryAt?: unknown } {
    return typeof body === 'object' && body !== null ? body : {};
}

/** Map an HTTP status + error body to the failure the screen shows. */
export function mapClaimError(status: number, body: unknown): ClaimFailure {
    const { code, retryAt } = bodyCode(body);
    if (status === 401 && code === 'claim_code_invalid') return { kind: 'wrong' };
    if (status === 410 && code === 'claim_expired') return { kind: 'expired' };
    if (status === 403 && code === 'claim_https_required') return { kind: 'https' };
    if (status === 409 && code === 'claim_not_available') return { kind: 'unavailable' };
    if (status === 429 && code === 'claim_locked') {
        return { kind: 'locked', retryAt: typeof retryAt === 'string' ? retryAt : null };
    }
    return { kind: 'generic' };
}

/** POST the claim; resolves the access token or throws `ClaimRequestError`. */
export async function postClaim(input: SetupClaimRequestDto): Promise<string> {
    let response: Response;
    try {
        response = await nativeFetch(`${API_BASE_URL}/setup/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            credentials: 'include', // honour the httpOnly rl_rt Set-Cookie
        });
    } catch {
        throw new ClaimRequestError({ kind: 'generic' });
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ClaimRequestError(mapClaimError(response.status, body));
    const token = bodyCode(body) as { access_token?: unknown };
    if (typeof token.access_token !== 'string') throw new ClaimRequestError({ kind: 'generic' });
    return token.access_token;
}

/** Claim the instance; resolves the access token. Signing in is {@link useClaimSignIn}'s job. */
export function useClaim(): UseMutationResult<string, ClaimRequestError, SetupClaimRequestDto> {
    return useMutation<string, ClaimRequestError, SetupClaimRequestDto>({ mutationFn: postClaim });
}

/** What {@link useClaimSignIn} exposes. */
export interface ClaimSignIn {
    /** True while `login()` fetches the new admin's profile. */
    signingIn: boolean;
    /** Sign in with the claim's token; resolves whether a session now exists. */
    signIn: (accessToken: string) => Promise<boolean>;
}

/**
 * Sign in as admin@local with the claim's token. Runs AFTER the claim
 * mutation has settled: `login()` drops the viewer-private caches, the
 * mutation cache included, which must never happen under a pending mutation.
 */
export function useClaimSignIn(): ClaimSignIn {
    const { login } = useAuth();
    const [signingIn, setSigningIn] = useState(false);
    const signIn = useCallback(async (accessToken: string): Promise<boolean> => {
        setSigningIn(true);
        setAuthMethod('local');
        clearSilentGuard();
        try {
            return (await login(accessToken)) !== null;
        } finally {
            setSigningIn(false);
        }
    }, [login]);
    return { signingIn, signIn };
}
