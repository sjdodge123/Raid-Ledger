/**
 * Pure helpers + approved copy for the claim screen (ROK-1701).
 * No React, no fetch — unit-tested in `claim.helpers.test.ts`.
 */
import { SETUP_CLAIM_PASSWORD_MAX_BYTES, SETUP_CLAIM_PASSWORD_MIN } from '@raid-ledger/contract';

const HOUR_MS = 3_600_000;
const utf8 = new TextEncoder();

export type MessageTone = 'muted' | 'danger' | 'warning' | 'success';

/** Why the server refused a claim, mapped from the coded error body. */
export type ClaimFailure =
    | { kind: 'wrong' }
    | { kind: 'expired' }
    | { kind: 'locked'; retryAt: string | null }
    | { kind: 'https' }
    | { kind: 'unavailable' }
    /** The server refused the password (400) — shown on the password field. */
    | { kind: 'password' }
    | { kind: 'generic' };

/** What the message slot under the setup-code field shows (never a password refusal). */
export type CodeStatus = { kind: 'idle' } | { kind: 'empty' } | { kind: 'ok' } | Exclude<ClaimFailure, { kind: 'password' }>;

export interface SlotMessage { text: string; tone: MessageTone; alert: boolean }

/** Shown when the client-side password guard refuses a submit. */
export const PASSWORD_GUARD_MESSAGE =
    `Choose a password of at least ${SETUP_CLAIM_PASSWORD_MIN} characters and type it the same way twice.`;

export const PASSWORD_MISMATCH_MESSAGE = "The two passwords don't match.";

/** Shown when the password passes the 72-byte bcrypt cap. */
export const PASSWORD_TOO_LONG_MESSAGE =
    `That password is too long. Keep it to ${SETUP_CLAIM_PASSWORD_MAX_BYTES} bytes; accented letters and emoji count as 2 to 4 each.`;

/** 0 empty, 1 under 8, 2 under the minimum, 3 valid, 4 past the byte cap. */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

/** True when the password is over the contract's UTF-8 byte cap. */
export function isPasswordTooLong(password: string): boolean {
    return utf8.encode(password).length > SETUP_CLAIM_PASSWORD_MAX_BYTES;
}

/** The contract's password rule: at least the minimum chars, at most the byte cap. */
export function isPasswordValid(password: string): boolean {
    return password.length >= SETUP_CLAIM_PASSWORD_MIN && !isPasswordTooLong(password);
}

/** Length-based strength level for the meter and hint. */
export function passwordStrength(password: string): StrengthLevel {
    if (password.length === 0) return 0;
    if (isPasswordTooLong(password)) return 4;
    if (password.length < 8) return 1;
    if (password.length < SETUP_CLAIM_PASSWORD_MIN) return 2;
    return 3;
}

const STRENGTH_HINTS: Record<StrengthLevel, { text: string; tone: MessageTone }> = {
    0: { text: 'Use at least 12 characters. A short sentence works well.', tone: 'muted' },
    1: { text: 'Too short.', tone: 'danger' },
    2: { text: 'Nearly there: 12 characters or more.', tone: 'warning' },
    3: { text: 'Strong enough.', tone: 'success' },
    4: { text: `Too long: ${SETUP_CLAIM_PASSWORD_MAX_BYTES} bytes at most.`, tone: 'danger' },
};

/** The hint under the new-password field for a strength level. */
export function strengthHint(level: StrengthLevel): { text: string; tone: MessageTone } {
    return STRENGTH_HINTS[level];
}

/** Whole hours until the code stops working, rounded up (a fresh 72h code reads 72), never negative. */
export function hoursLeft(expiresAt: string, now: number): number {
    return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / HOUR_MS));
}

/** True once `now` reaches the expiry instant; false when there is none. */
export function isClaimExpired(expiresAt: string | undefined, now: number): boolean {
    if (!expiresAt) return false;
    return now >= Date.parse(expiresAt);
}

function lockedText(retryAt: string | null): string {
    if (!retryAt) return 'Too many wrong codes. Claiming is paused for 15 minutes — try again later.';
    const hhmm = new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Too many wrong codes. Claiming is paused for 15 minutes — try again at ${hhmm}.`;
}

const danger = (text: string): SlotMessage => ({ text, tone: 'danger', alert: true });

/** The message-slot copy, tone and live-region role for a code status. */
export function codeMessage(status: CodeStatus): SlotMessage {
    switch (status.kind) {
        case 'idle': return { text: 'Paste the whole value. Long codes from Render work exactly as they are.', tone: 'muted', alert: false };
        case 'empty': return danger('Enter your setup code first.');
        case 'ok': return { text: 'Code accepted. This Raid Ledger is yours.', tone: 'success', alert: false };
        case 'wrong': return danger("That code doesn't match. Copy it again from your host; a character is easy to miss.");
        case 'expired': return danger('This code has expired. Restart the service for a new code.');
        case 'locked': return { text: lockedText(status.retryAt), tone: 'warning', alert: true };
        case 'https': return danger('Open this page over https:// to claim it.');
        case 'unavailable': return danger('This Raid Ledger has already been claimed. Sign in instead.');
        case 'generic': return danger('Something went wrong. Try again.');
    }
}

/** Token text class per tone — never a raw colour (15 themes). */
export const TONE_TEXT: Record<MessageTone, string> = {
    muted: 'text-muted', danger: 'text-danger', warning: 'text-warning', success: 'text-success',
};
