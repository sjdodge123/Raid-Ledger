/**
 * ROK-2283: spend a `/signin-link` token, once, when the member taps Continue.
 *
 * POSTed as JSON (the endpoints answer 415 otherwise — login-CSRF guard) to the
 * endpoint the token's kind names. The raw token is never stored or logged.
 * - 'ok'    → a session was adopted (in-memory access token + refresh cookie)
 * - 'dead'  → 401: used, expired, or refused (one generic answer by design)
 * - 'retry' → 429, 5xx, network or bad body: nothing adopted, try again
 */
import { TokenResponseSchema, type RedeemDiscordLinkDto } from '@raid-ledger/contract';
import { API_BASE_URL } from './config';
import { setAccessToken } from './api/access-token-store';
import { clearSilentGuard, setAuthMethod } from './api/silent-reauth';
import { nativeFetch } from './api/native-fetch';
import { SIGNIN_LINK_REDEEM_PATH, type SigninLinkKind } from './signin-link-token';

export type SigninLinkRedeemOutcome = 'ok' | 'dead' | 'retry';

async function readAccessToken(res: Response): Promise<string | null> {
    const parsed = TokenResponseSchema.safeParse(await res.json().catch(() => null));
    return parsed.success ? parsed.data.access_token : null;
}

/** Exchange the token for a session. Never rejects. */
export async function redeemSigninLink(token: string, kind: SigninLinkKind): Promise<SigninLinkRedeemOutcome> {
    const body: RedeemDiscordLinkDto = { token };
    try {
        const res = await nativeFetch(`${API_BASE_URL}${SIGNIN_LINK_REDEEM_PATH[kind]}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 401) return 'dead';
        if (!res.ok) return 'retry';
        const accessToken = await readAccessToken(res);
        if (!accessToken) return 'retry';
        setAccessToken(accessToken);
        setAuthMethod('magic');
        clearSilentGuard();
        return 'ok';
    } catch {
        return 'retry';
    }
}
