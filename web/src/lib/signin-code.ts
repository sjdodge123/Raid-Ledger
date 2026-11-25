/**
 * ROK-2370: the Discord-app sign-in code — start a code, poll for its
 * approval, and keep the pending code in sessionStorage so a reload on the
 * way back from Discord resumes the same code.
 *
 * Both endpoints take JSON only (the API answers 415 otherwise). The device
 * secret never leaves this browser; it is the only thing that can collect the
 * session once a member approves the code in Discord.
 */
import {
    SigninCodePollResponseSchema,
    SigninCodeStartResponseSchema,
    type SigninCodePollResponseDto,
    type SigninCodeStartResponseDto,
} from '@raid-ledger/contract';
import { API_BASE_URL } from './config';
import { nativeFetch } from './api/native-fetch';
import { safeSessionGetItem, safeSessionRemoveItem, safeSessionSetItem } from './safe-storage';

/** sessionStorage key for the pending code (tab-scoped, survives reload). */
export const SIGNIN_CODE_STORAGE_KEY = 'rl_signin_code';

const START_PATH = '/auth/discord/signin-code';
const POLL_PATH = '/auth/discord/signin-code/poll';

/** A started code as the browser keeps it. */
export type PendingSigninCode = SigninCodeStartResponseDto;

/** A poll answer, or `retry` for 429 / 5xx / network / unreadable body. */
export type SigninCodePollOutcome = SigninCodePollResponseDto | { status: 'retry' };

/** POST JSON with the refresh cookie honoured; never rejects (null on network error). */
async function postJson(path: string, body: unknown): Promise<Response | null> {
    try {
        return await nativeFetch(`${API_BASE_URL}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch {
        return null;
    }
}

/** Start a new code. `null` when the server refused (429) or was unreachable. */
export async function startSigninCode(): Promise<PendingSigninCode | null> {
    const res = await postJson(START_PATH, {});
    if (!res?.ok) return null;
    const parsed = SigninCodeStartResponseSchema.safeParse(await res.json().catch(() => null));
    return parsed.success ? parsed.data : null;
}

/** Ask whether the code was approved. Never rejects. */
export async function pollSigninCode(deviceSecret: string): Promise<SigninCodePollOutcome> {
    const res = await postJson(POLL_PATH, { deviceSecret });
    if (!res?.ok) return { status: 'retry' };
    const parsed = SigninCodePollResponseSchema.safeParse(await res.json().catch(() => null));
    return parsed.success ? parsed.data : { status: 'retry' };
}

/** `m:ss` for a non-negative millisecond count (the panel's countdown). */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Remember the pending code for this tab. A no-op when storage is blocked. */
export function savePendingSigninCode(code: PendingSigninCode): void {
    safeSessionSetItem(SIGNIN_CODE_STORAGE_KEY, JSON.stringify(code));
}

/** Forget the pending code (cancel, close, expiry, success). */
export function clearPendingSigninCode(): void {
    safeSessionRemoveItem(SIGNIN_CODE_STORAGE_KEY);
}

/** The saved code when it is well-formed and not yet expired at `now`; junk is cleared. */
export function readPendingSigninCode(now: number): PendingSigninCode | null {
    const raw = safeSessionGetItem(SIGNIN_CODE_STORAGE_KEY);
    if (!raw) return null;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        value = null;
    }
    const parsed = SigninCodeStartResponseSchema.safeParse(value);
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= now) {
        clearPendingSigninCode();
        return null;
    }
    return parsed.data;
}
