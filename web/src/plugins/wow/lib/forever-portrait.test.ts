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
            .toEqual({ kind: 'tile', classIconUrl: MAGE_ICON, raceInitial: 'NE', label: 'Night Elf Mage' });
    });

    it('returns the class icon alone when the race is null', () => {
        expect(selectForeverPortrait({ variant: forever, race: null, characterClass: 'Mage', name: 'Ayla' }))
            .toEqual({ kind: 'class-only', classIconUrl: MAGE_ICON, label: 'Mage' });
    });

    it('returns the class icon alone for a race it does not know (Skyborne)', () => {
        expect(selectForeverPortrait({ variant: forever, race: 'Skyborne', characterClass: 'Mage', name: 'Ayla' }).kind)
            .toBe('class-only');
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
    });
});
