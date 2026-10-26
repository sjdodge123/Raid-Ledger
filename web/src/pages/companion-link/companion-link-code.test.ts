/** ROK-1955 T-WEB-1 helpers — code formatting and URL prefill. */
import { describe, expect, it } from 'vitest';
import { formatUserCodeInput, readPrefilledCode, relativeMinutes } from './companion-link-code';

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
    it('falls back to ?code= (the RFC 8628 verificationUriComplete the API emits)', () => {
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
