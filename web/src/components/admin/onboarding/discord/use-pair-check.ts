import { useEffect, useState } from 'react';
import type { DiscordOAuthTestDto } from '@raid-ledger/contract';
import { adminFetch } from '../../../../hooks/admin/admin-fetch';
import type { OAuthTestResponse } from '../../../../hooks/admin/admin-settings-types';
import { checkAppId, checkSecret, interpretPairResult, type PairStates } from './keys-validation';

export const PAIR_DEBOUNCE_MS = 600;

type PairAnswer = { id: string; secret: string; attempt: number; success: boolean; message: string; retryable?: boolean };

function testPair(body: DiscordOAuthTestDto): Promise<OAuthTestResponse> {
    return adminFetch('/admin/settings/oauth/test', { method: 'POST', body: JSON.stringify(body) }, 'Could not check the ID and secret');
}

/**
 * Live ID + secret check (AC-4, D-5): once both pass the format check, 600 ms
 * after the last keystroke the typed pair goes to `POST …/oauth/test`.
 * "Checking" is derived (the last answer is for a different pair or an
 * older attempt), so no state is set synchronously inside the effect.
 * `recheck` asks again for the same pair (Discord busy, unreachable).
 */
export function usePairCheck(appId: string, secret: string): PairStates & { recheck: () => void } {
    const [answer, setAnswer] = useState<PairAnswer | null>(null);
    const [attempt, setAttempt] = useState(0);
    const recheck = () => setAttempt((n) => n + 1);
    const idFormat = checkAppId(appId);
    const secretFormat = checkSecret(secret);
    const ready = idFormat.status === 'ok' && secretFormat.status === 'ok';
    const id = appId.trim();
    const sec = secret.trim();

    useEffect(() => {
        if (!ready) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            testPair({ clientId: id, clientSecret: sec })
                .then((r) => { if (!cancelled) setAnswer({ id, secret: sec, attempt, success: r.success, message: r.message, ...(r.retryable ? { retryable: true } : {}) }); })
                .catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : 'Could not reach Discord. Try again.';
                    if (!cancelled) setAnswer({ id, secret: sec, attempt, success: false, message, retryable: true });
                });
        }, PAIR_DEBOUNCE_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [ready, id, sec, attempt]);

    if (!ready) return { idState: idFormat, secretState: secretFormat, recheck };
    const current = answer && answer.id === id && answer.secret === sec && answer.attempt === attempt ? answer : null;
    return { ...interpretPairResult(current), recheck };
}
