import { describe, expect, it } from 'vitest';
import { raceInitials, selectForeverPortrait } from './forever-portrait';
import { resolveWowVariant } from './wow-variant-config';
import { getClassIconUrl } from './class-icons';

const forever = resolveWowVariant({ gameVariant: null, ruleset: 'pvp' });
const MAGE_ICON = getClassIconUrl('Mage');

describe('selectForeverPortrait (ROK-1761)', () => {
    it('resolves a manual Forever character (gameVariant null + ruleset) as Forever', () => {
        expect(forever).toBe('wow_forever');
    });

    it('returns the class + race tile when both are known', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Night Elf', characterClass: 'Mage', name: 'Ayla' }))
            .toEqual({ kind: 'tile', classIconUrl: MAGE_ICON, raceInitial: 'NE', label: 'Ayla' });
    });

    it('returns the class icon alone when the race is null', () => {
        expect(selectForeverPortrait({ variant: forever, race: null, characterClass: 'Mage', name: 'Ayla' }))
            .toEqual({ kind: 'class-only', classIconUrl: MAGE_ICON, label: 'Ayla' });
    });

    it('returns the class icon alone when the race is empty or whitespace', () => {
        expect(selectForeverPortrait({ variant: forever, race: '', characterClass: 'Mage', name: 'Ayla' }).kind).toBe('class-only');
        expect(selectForeverPortrait({ variant: forever, race: '   ', characterClass: 'Mage', name: 'Ayla' }).kind).toBe('class-only');
    });

    it('labels any race the addon stored verbatim — Skyborne gets initial "S"', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Skyborne', characterClass: 'Mage', name: 'Ayla' }))
            .toEqual({ kind: 'tile', classIconUrl: MAGE_ICON, raceInitial: 'S', label: 'Ayla' });
    });

    it('returns the neutral glyph when the class is null or unknown', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Human', characterClass: null, name: 'Ayla' }))
            .toEqual({ kind: 'neutral', label: 'Ayla' });
        expect(selectForeverPortrait({ variant: forever, race: null, characterClass: 'Stormcaller', name: 'Ayla' }).kind)
            .toBe('neutral');
    });

    it('keeps a Forever character that has a render on its existing avatar', () => {
        expect(selectForeverPortrait({ variant: forever, avatarUrl: 'https://x/a.jpg', race: 'Human', characterClass: 'Mage', name: 'A' }))
            .toEqual({ kind: 'none' });
    });

    it('leaves non-Forever characters on their existing avatar', () => {
        const input = { avatarUrl: null, race: 'Human', characterClass: 'Mage', name: 'A' };
        expect(selectForeverPortrait({ ...input, variant: resolveWowVariant({ gameVariant: 'retail', ruleset: null }) }).kind).toBe('none');
        expect(selectForeverPortrait({ ...input, variant: resolveWowVariant({ gameVariant: 'classic_era', ruleset: null }) }).kind).toBe('none');
        expect(selectForeverPortrait({ ...input, variant: resolveWowVariant({ gameVariant: null, ruleset: null }) }).kind).toBe('none');
    });

    it('builds race initials from each word', () => {
        expect(raceInitials('Human')).toBe('H');
        expect(raceInitials('Blood Elf')).toBe('BE');
        expect(raceInitials('Night Elf')).toBe('NE');
        expect(raceInitials('Skyborne')).toBe('S');
    });

    it('splits camelCase race names and caps at two letters', () => {
        expect(raceInitials('NightElf')).toBe('NE');
        expect(raceInitials('HighmountainTauren')).toBe('HT');
        expect(raceInitials('Dark Iron Dwarf')).toBe('DI');
        expect(raceInitials('  ')).toBe('');
    });
});

describe('selectForeverPortrait race portrait (ROK-1747)', () => {
    const NE_FEMALE = 'https://wow.zamimg.com/images/wow/icons/large/race_nightelf_female.jpg';

    it('returns the race portrait with a class badge and the class tile as fallback', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Night Elf', gender: 'female', characterClass: 'Mage', name: 'Ayla' }))
            .toEqual({
                kind: 'race', raceIconUrl: NE_FEMALE, classIconUrl: MAGE_ICON, label: 'Ayla',
                fallback: { kind: 'tile', classIconUrl: MAGE_ICON, raceInitial: 'NE', label: 'Ayla' },
            });
    });

    it('keeps the class tile when the gender is unknown', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Night Elf', gender: null, characterClass: 'Mage', name: 'Ayla' }).kind)
            .toBe('tile');
    });

    it('keeps the class tile for a race with no icon (Skyborne)', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Skyborne', gender: 'female', characterClass: 'Mage', name: 'Ayla' }).kind)
            .toBe('tile');
    });

    it('returns a race portrait with no class badge and a neutral fallback for an unknown class', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Night Elf', gender: 'female', characterClass: null, name: 'Ayla' }))
            .toEqual({ kind: 'race', raceIconUrl: NE_FEMALE, classIconUrl: null, label: 'Ayla', fallback: { kind: 'neutral', label: 'Ayla' } });
    });

    it('still prefers an existing render, and leaves non-Forever characters alone', () => {
        const input = { race: 'Night Elf', gender: 'female', characterClass: 'Mage', name: 'Ayla' };
        expect(selectForeverPortrait({ ...input, variant: forever, avatarUrl: 'https://x/a.jpg' })).toEqual({ kind: 'none' });
        expect(selectForeverPortrait({ ...input, variant: resolveWowVariant({ gameVariant: 'classic_era', ruleset: null }) }))
            .toEqual({ kind: 'none' });
    });
});
