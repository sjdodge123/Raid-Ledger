import { describe, expect, it } from 'vitest';
import {
    codeMessage, hoursLeft, isClaimExpired, isPasswordTooLong, isPasswordValid, passwordStrength, strengthHint,
} from './claim.helpers';

const HOUR = 3_600_000;

describe('passwordStrength', () => {
    it.each([
        ['', 0],
        ['short', 1],
        ['12345678', 2],
        ['12345678901', 2],
        ['123456789012', 3],
        ['x'.repeat(72), 3],
        ['x'.repeat(73), 4],
        ['é'.repeat(37), 4],
    ] as const)('"%s" → %d', (pw, level) => {
        expect(passwordStrength(pw)).toBe(level);
    });

    it('hints by level with a tone', () => {
        expect(strengthHint(0)).toEqual({ text: 'Use at least 12 characters. A short sentence works well.', tone: 'muted' });
        expect(strengthHint(1)).toEqual({ text: 'Too short.', tone: 'danger' });
        expect(strengthHint(2)).toEqual({ text: 'Nearly there: 12 characters or more.', tone: 'warning' });
        expect(strengthHint(3)).toEqual({ text: 'Strong enough.', tone: 'success' });
        expect(strengthHint(4)).toEqual({ text: expect.stringMatching(/^Too long/), tone: 'danger' });
    });

    it('validates min chars and the 72-byte cap, counting bytes', () => {
        expect(isPasswordValid('x'.repeat(11))).toBe(false);
        expect(isPasswordValid('x'.repeat(12))).toBe(true);
        expect(isPasswordValid('é'.repeat(36))).toBe(true);
        expect(isPasswordTooLong('é'.repeat(36))).toBe(false);
        expect(isPasswordTooLong('é'.repeat(37))).toBe(true);
        expect(isPasswordValid('é'.repeat(37))).toBe(false);
    });
});

describe('hoursLeft / isClaimExpired', () => {
    const now = Date.UTC(2026, 9, 30, 12, 0, 0);
    it('floors whole hours left', () => {
        expect(hoursLeft(new Date(now + 71.9 * HOUR).toISOString(), now)).toBe(71);
    });
    it('never goes below zero', () => {
        expect(hoursLeft(new Date(now - 5 * HOUR).toISOString(), now)).toBe(0);
    });
    it('is expired at or after the instant, not before', () => {
        expect(isClaimExpired(new Date(now).toISOString(), now)).toBe(true);
        expect(isClaimExpired(new Date(now + 1000).toISOString(), now)).toBe(false);
        expect(isClaimExpired(undefined, now)).toBe(false);
    });
});

describe('codeMessage', () => {
    it('maps every state to its approved copy and tone', () => {
        expect(codeMessage({ kind: 'idle' })).toMatchObject({ tone: 'muted', alert: false });
        expect(codeMessage({ kind: 'empty' })).toEqual({ text: 'Enter your setup code first.', tone: 'danger', alert: true });
        expect(codeMessage({ kind: 'wrong' }).text).toBe("That code doesn't match. Copy it again from your host; a character is easy to miss.");
        expect(codeMessage({ kind: 'ok' })).toEqual({ text: 'Code accepted. This Raid Ledger is yours.', tone: 'success', alert: false });
        expect(codeMessage({ kind: 'expired' }).text).toBe('This code has expired. Restart the service for a new code.');
        expect(codeMessage({ kind: 'https' }).text).toBe('Open this page over https:// to claim it.');
        expect(codeMessage({ kind: 'generic' }).text).toBe('Something went wrong. Try again.');
    });

    it('locked names the retry time in warning tone', () => {
        const retryAt = new Date(Date.UTC(2026, 9, 30, 13, 5)).toISOString();
        const msg = codeMessage({ kind: 'locked', retryAt });
        const hhmm = new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        expect(msg.tone).toBe('warning');
        expect(msg.text).toBe(`Too many wrong codes. Claiming is paused for 15 minutes — try again at ${hhmm}.`);
    });
});
