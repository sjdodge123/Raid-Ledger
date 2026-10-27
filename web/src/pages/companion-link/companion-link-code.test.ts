/** ROK-1955 T-WEB-1 helpers — code formatting and URL prefill. */
import { describe, expect, it } from 'vitest';
import type { CompanionLinkPreview } from '@raid-ledger/contract';
import { formatUserCodeInput, readPrefilledCode, relativeMinutes, timingLine } from './companion-link-code';

describe('formatUserCodeInput', () => {
    it('upper-cases and inserts the dash after four letters', () => {
        expect(formatUserCodeInput('bcdfghjk')).toBe('BCDF-GHJK');
    });
    it('keeps a partial code without a trailing dash', () => {
        expect(formatUserCodeInput('bcd')).toBe('BCD');
        expect(formatUserCodeInput('bcdf')).toBe('BCDF');
        expect(formatUserCodeInput('bcdfg')).toBe('BCDF-G');
    });
    it('drops separators, digits and anything past eight letters', () => {
        expect(formatUserCodeInput('bc-df 12gh jkxx')).toBe('BCDF-GHJK');
    });
});

describe('readPrefilledCode', () => {
    it('reads the fragment form first', () => {
        expect(readPrefilledCode('#code=bcdf-ghjk', '?code=ZZZZZZZZ')).toBe('BCDF-GHJK');
    });
    it('falls back to a legacy ?code= link', () => {
        expect(readPrefilledCode('', '?code=BCDFGHJK')).toBe('BCDF-GHJK');
    });
    it('returns null when neither carries a code', () => {
        expect(readPrefilledCode('', '')).toBeNull();
        expect(readPrefilledCode('#other=1', '?x=1')).toBeNull();
    });
});

describe('relativeMinutes', () => {
    it('rounds to whole minutes and floors at zero', () => {
        const now = Date.parse('2026-10-26T12:00:00Z');
        expect(relativeMinutes('2026-10-26T11:58:00Z', now)).toBe(-2);
        expect(relativeMinutes('2026-10-26T12:08:00Z', now)).toBe(8);
    });
});

describe('timingLine', () => {
    const NOW = Date.parse('2026-10-26T12:00:00.000Z');
    const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
    const linkPreview = (expiresInMs: number): CompanionLinkPreview => ({
        userCode: 'BCDF-GHJK',
        device: { name: 'Gaming-PC', os: 'windows', osVersion: '11', appVersion: '0.1.0' },
        requestedAt: at(-2 * 60_000),
        expiresAt: at(expiresInMs),
        requestedNetwork: '203.0.113.x',
        sameNetworkAsYou: true,
        status: 'pending',
    });
    it('counts the minutes left while the code is live', () => {
        expect(timingLine(linkPreview(8 * 60_000), NOW)).toBe('2 min ago · expires in 8 min');
    });
    it('says under a minute for the last seconds', () => {
        expect(timingLine(linkPreview(20_000), NOW)).toBe('2 min ago · expires in under a minute');
    });
    it('says the code may have expired once expiresAt has passed', () => {
        expect(timingLine(linkPreview(0), NOW)).toBe('2 min ago · may have expired');
        expect(timingLine(linkPreview(-90_000), NOW)).toBe('2 min ago · may have expired');
    });
});
