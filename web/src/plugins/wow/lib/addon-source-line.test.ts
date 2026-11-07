/** ROK-2109: source line wording for the addon and the Armory sync. */
import { describe, it, expect } from 'vitest';
import { asDatedSource, formatAddonSourceLine, formatSourceLine } from './addon-source-line';

describe('formatSourceLine', () => {
    it('labels an Armory snapshot "via Armory" with its date', () => {
        expect(formatSourceLine('blizzard', '2026-11-07T12:00:00.000Z')).toBe('via Armory · 7 Nov 2026');
    });

    it('keeps the addon wording', () => {
        expect(formatSourceLine('addon', '2026-10-01T12:00:00.000Z')).toBe('via addon · 1 Oct 2026');
        expect(formatAddonSourceLine('2026-10-01T12:00:00.000Z')).toBe('via addon · 1 Oct 2026');
    });

    it('drops the date when it does not parse', () => {
        expect(formatSourceLine('blizzard', 'not-a-date')).toBe('via Armory');
        expect(formatSourceLine('addon', '')).toBe('via addon');
    });
});

describe('asDatedSource', () => {
    it('keeps addon / blizzard and drops everything else', () => {
        expect(asDatedSource('addon')).toBe('addon');
        expect(asDatedSource('blizzard')).toBe('blizzard');
        expect(asDatedSource('manual')).toBeNull();
        expect(asDatedSource(null)).toBeNull();
        expect(asDatedSource(undefined)).toBeNull();
    });
});
