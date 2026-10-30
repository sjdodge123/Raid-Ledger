/**
 * `POST /setup/claim` mutation + coded-error mapping (ROK-1701).
 *
 * Uses `nativeFetch` like the local sign-in: a 401 here means "wrong code",
 * not "session expired", so it must bypass the silent re-auth interceptor.
 * The code travels only in the JSON body — never a URL, never a log.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { SetupClaimRequestDto } from '@raid-ledger/contract';
import { useAuth, type User } from '../../hooks/use-auth';
import { API_BASE_URL } from '../../lib/config';
import { nativeFetch } from '../../lib/api/native-fetch';
import { clearSilentGuard, setAuthMethod } from '../../lib/api/silent-reauth';
import type { ClaimFailure } from './claim.helpers';

/** A refused claim, carrying only the mapped failure (no code, no password). */
export class ClaimRequestError extends Error {
    constructor(readonly failure: ClaimFailure) {
        super(`setup claim refused: ${failure.kind}`);
        this.name = 'ClaimRequestError';
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

/** Claim the instance, then sign in as admin@local with the returned token. */
export function useClaim(): UseMutationResult<User | null, ClaimRequestError, SetupClaimRequestDto> {
    const { login } = useAuth();
    return useMutation<User | null, ClaimRequestError, SetupClaimRequestDto>({
        mutationFn: async (input) => {
            const accessToken = await postClaim(input);
            setAuthMethod('local');
            clearSilentGuard();
            return login(accessToken);
        },
    });
}
