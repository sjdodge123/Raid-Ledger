/**
 * ROK-1703 4c — pure checks for the three key fields (AC-4, D-5). The token
 * result interpretation is kept pure so the states are unit-testable.
 */
import { PRIVILEGED_INTENT_LABELS, type DiscordBotTestResult, type PrivilegedIntent } from '@raid-ledger/contract';

export type CheckStatus = 'idle' | 'checking' | 'ok' | 'warn' | 'bad';

export interface CheckState {
    status: CheckStatus;
    message?: string;
    missingIntents?: PrivilegedIntent[];
    /** Discord couldn't be asked (busy / unreachable): unverified, offer "Check again". */
    retry?: boolean;
}

export const APP_ID_RE = /^\d{17,20}$/;
const TOKEN_SHAPE_RE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const IDLE: CheckState = { status: 'idle' };

export function checkAppId(raw: string): CheckState {
    const v = raw.trim();
    if (!v) return IDLE;
    if (APP_ID_RE.test(v)) return { status: 'ok', message: 'Looks right. Discord checks it together with the secret.' };
    return { status: 'bad', message: 'An Application ID is 17 to 20 digits. Copy it from General Information.' };
}

export function checkSecret(raw: string): CheckState {
    const v = raw.trim();
    if (!v) return IDLE;
    if (TOKEN_SHAPE_RE.test(v)) return { status: 'bad', message: "That's your bot token. The client secret is under OAuth2 → Client Secret." };
    if (v.length < 20 || /\s/.test(v)) return { status: 'bad', message: "That doesn't look like a client secret. Copy it from OAuth2 → Client Secret." };
    return { status: 'ok', message: 'Looks right. Discord checks it together with the ID.' };
}

export interface PairStates { idState: CheckState; secretState: CheckState }

/**
 * D-5: what the live `oauth/test` answer for the typed ID + secret means for
 * both fields (null = still waiting). Discord can't say which half is wrong,
 * so a rejection marks both.
 */
export function interpretPairResult(r: { success: boolean; message: string; retryable?: boolean } | null): PairStates {
    if (!r) {
        return {
            idState: { status: 'checking', message: 'Checking with the secret…' },
            secretState: { status: 'checking', message: 'Checking the ID and secret with Discord…' },
        };
    }
    if (r.retryable) {
        const unchecked: CheckState = { status: 'warn', message: r.message, retry: true };
        return { idState: unchecked, secretState: unchecked };
    }
    if (r.success) {
        return {
            idState: { status: 'ok', message: 'Discord found this application.' },
            secretState: { status: 'ok', message: 'Discord accepted the ID and secret together.' },
        };
    }
    return {
        idState: { status: 'bad', message: "Discord didn't accept this ID with that secret. Check both." },
        secretState: { status: 'bad', message: r.message },
    };
}

/** Checks that need no network call; null = go ask Discord. */
export function precheckToken(token: string, secret: string): CheckState | null {
    const v = token.trim();
    if (!v) return IDLE;
    if (secret.trim() && v === secret.trim()) {
        return { status: 'bad', message: "That's your client secret. The bot token is on the Bot page: click Reset Token, then copy it." };
    }
    return null;
}

/** What the `discord-bot/test` answer means for the token field. */
export function interpretTokenResult(r: DiscordBotTestResult, appId: string): CheckState {
    const id = appId.trim();
    if (r.applicationId && APP_ID_RE.test(id) && r.applicationId !== id) {
        return { status: 'bad', message: 'This token belongs to a different application. Copy the token from the same application as the ID above.' };
    }
    if (r.missingIntents && r.missingIntents.length > 0) {
        return { status: 'warn', message: 'Token works, but a switch is still off (below).', missingIntents: r.missingIntents };
    }
    if (r.success) {
        // `[]` = all three on (chips shown); absent = Discord didn't say (no chips).
        return { status: 'ok', message: 'Token works. Your bot can sign in to Discord.', ...(r.missingIntents ? { missingIntents: r.missingIntents } : {}) };
    }
    return { status: 'bad', message: r.message };
}

function joinNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Turn on Message Content Intent…" — the D-11 named-intent line (AC-5). */
export function missingIntentsMessage(missing: PrivilegedIntent[]): string {
    const names = joinNames(missing.map((k) => PRIVILEGED_INTENT_LABELS[k]));
    const plural = missing.length > 1;
    return `Discord says ${names} ${plural ? 'are' : 'is'} off. Turn ${plural ? 'them' : 'it'} on, click Save Changes, then click Check again.`;
}
