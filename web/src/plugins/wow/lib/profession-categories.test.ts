/**
 * Vitest — profession-categories (ROK-1179 follow-up to ROK-1130).
 *
 * Pins inclusion AND exclusion of era-gated professions:
 *   • Jewelcrafting added in BC (excluded from vanilla)
 *   • Inscription added in Wrath (excluded from vanilla + BC)
 *   • Archaeology added in Cataclysm (excluded from vanilla, BC, wrath)
 *   • First Aid removed from retail (still in every Classic era)
 */
import { describe, it, expect } from 'vitest';
import {
    getProfessionOptions,
    getMaxEntriesForCategory,
} from './profession-categories';

const VANILLA = 'world-of-warcraft-classic';
const BC = 'world-of-warcraft-burning-crusade-classic';
const WRATH = 'world-of-warcraft-wrath-of-the-lich-king-classic';
const CATACLYSM = 'world-of-warcraft-cataclysm-classic';
const MOP = 'world-of-warcraft-mists-of-pandaria-classic';
const RETAIL_FALLBACK = null;

describe('getProfessionOptions — primary inclusion/exclusion by era', () => {
    it('vanilla excludes Jewelcrafting and Inscription', () => {
        const options = getProfessionOptions('primary', VANILLA);
        expect(options).not.toContain('Jewelcrafting');
        expect(options).not.toContain('Inscription');
        expect(options).toContain('Tailoring');
        expect(options).toContain('Mining');
    });

    it('bc adds Jewelcrafting but not Inscription', () => {
        const options = getProfessionOptions('primary', BC);
        expect(options).toContain('Jewelcrafting');
        expect(options).not.toContain('Inscription');
    });

    it('wrath adds Inscription on top of Jewelcrafting', () => {
        const options = getProfessionOptions('primary', WRATH);
        expect(options).toContain('Jewelcrafting');
        expect(options).toContain('Inscription');
    });

    it('cataclysm primary still includes both', () => {
        const options = getProfessionOptions('primary', CATACLYSM);
        expect(options).toContain('Jewelcrafting');
        expect(options).toContain('Inscription');
    });

    it('retail (fallback) primary includes both', () => {
        const options = getProfessionOptions('primary', RETAIL_FALLBACK);
        expect(options).toContain('Jewelcrafting');
        expect(options).toContain('Inscription');
    });
});

describe('getProfessionOptions — secondary inclusion/exclusion by era', () => {
    it('vanilla secondary is Cooking, Fishing, First Aid (no Archaeology)', () => {
        const options = getProfessionOptions('secondary', VANILLA);
        expect(options).toEqual(['Cooking', 'Fishing', 'First Aid']);
    });

    it('bc secondary excludes Archaeology', () => {
        const options = getProfessionOptions('secondary', BC);
        expect(options).not.toContain('Archaeology');
        expect(options).toContain('First Aid');
    });

    it('wrath secondary excludes Archaeology', () => {
        const options = getProfessionOptions('secondary', WRATH);
        expect(options).not.toContain('Archaeology');
        expect(options).toContain('First Aid');
    });

    it('cataclysm secondary includes Archaeology AND First Aid', () => {
        const options = getProfessionOptions('secondary', CATACLYSM);
        expect(options).toContain('Archaeology');
        expect(options).toContain('First Aid');
    });

    it('mop secondary still includes Archaeology AND First Aid', () => {
        const options = getProfessionOptions('secondary', MOP);
        expect(options).toContain('Archaeology');
        expect(options).toContain('First Aid');
    });

    it('retail (fallback) secondary excludes First Aid (removed in BfA) but keeps Archaeology', () => {
        const options = getProfessionOptions('secondary', RETAIL_FALLBACK);
        expect(options).not.toContain('First Aid');
        expect(options).toContain('Archaeology');
    });
});

describe('getMaxEntriesForCategory — primary always 2', () => {
    it.each([VANILLA, BC, WRATH, CATACLYSM, MOP, RETAIL_FALLBACK])(
        'primary cap is 2 for %s',
        (slug) => {
            expect(getMaxEntriesForCategory('primary', slug)).toBe(2);
        },
    );
});

describe('getMaxEntriesForCategory — secondary length matches options', () => {
    it.each<[string | null, number]>([
        [VANILLA, 3],
        [BC, 3],
        [WRATH, 3],
        [CATACLYSM, 4],
        [MOP, 4],
        [RETAIL_FALLBACK, 3],
    ])('secondary cap matches getProfessionOptions length for %s', (slug, expected) => {
        expect(getMaxEntriesForCategory('secondary', slug)).toBe(expected);
        expect(getProfessionOptions('secondary', slug).length).toBe(expected);
    });
});
