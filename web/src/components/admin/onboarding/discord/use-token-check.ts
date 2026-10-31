import { useEffect, useState } from 'react';
import type { DiscordBotTestResult } from '@raid-ledger/contract';
import { adminFetch } from '../../../../hooks/admin/admin-fetch';
import { interpretTokenResult, precheckToken, type CheckState } from './keys-validation';

export const TOKEN_DEBOUNCE_MS = 600;

type Answer = { token: string; attempt: number } & ({ result: DiscordBotTestResult } | { error: string });

function testToken(botToken: string): Promise<DiscordBotTestResult> {
    return adminFetch('/admin/settings/discord-bot/test', { method: 'POST', body: JSON.stringify({ botToken }) }, 'Failed to test the bot token');
}

/**
 * Live token check (AC-4): 600 ms after the last keystroke the token goes to
 * `POST …/discord-bot/test`. "Checking" is derived (the last answer is for a
 * different token or an older attempt), so no state is set synchronously
 * inside the effect. Re-pasting the same token changes nothing React can see,
 * so `recheck` asks again for the same token (after a switch is turned on, or
 * a transient failure).
 */
export function useTokenCheck(token: string, secret: string, appId: string): { state: CheckState; recheck: () => void } {
    const [answer, setAnswer] = useState<Answer | null>(null);
    const [attempt, setAttempt] = useState(0);
    const recheck = () => setAttempt((n) => n + 1);
    const pre = precheckToken(token, secret);
    const value = token.trim();

    useEffect(() => {
        if (pre) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            testToken(value)
                .then((result) => { if (!cancelled) setAnswer({ token: value, attempt, result }); })
                .catch((err: unknown) => {
                    if (!cancelled) setAnswer({ token: value, attempt, error: err instanceof Error ? err.message : 'Could not reach Discord. Try again.' });
                });
        }, TOKEN_DEBOUNCE_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [value, pre, attempt]);

    if (pre) return { state: pre, recheck };
    if (!answer || answer.token !== value || answer.attempt !== attempt) return { state: { status: 'checking', message: 'Checking with Discord…' }, recheck };
    if ('error' in answer) return { state: { status: 'bad', message: answer.error, retry: true }, recheck };
    return { state: interpretTokenResult(answer.result, appId), recheck };
}
