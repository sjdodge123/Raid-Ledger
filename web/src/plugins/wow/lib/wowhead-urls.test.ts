import { describe, it, expect } from 'vitest';
import {
    getWowheadQuestUrl,
    getWowheadItemUrl,
    getWowheadDataSuffix,
    getWowheadNpcSearchUrl,
    getWowheadItemData,
    getWowheadQuestData,
    getWowheadTalentCalcUrl,
    getWowheadTalentCalcEmbedUrl,
    getWowheadItemUrlForExpansion,
    getWowheadDataSuffixForExpansion,
} from './wowhead-urls';

describe('wowhead-urls', () => {
    describe('getWowheadQuestUrl', () => {
        it('returns www.wowhead.com for retail variant', () => {
            expect(getWowheadQuestUrl(100, 'retail')).toBe('https://www.wowhead.com/quest=100');
        });

        it('returns tbc domain for classic_anniversary variant', () => {
            expect(getWowheadQuestUrl(100, 'classic_anniversary')).toBe('https://www.wowhead.com/tbc/quest=100');
        });

        it('returns classic domain for classic_era variant', () => {
            expect(getWowheadQuestUrl(100, 'classic_era')).toBe('https://www.wowhead.com/classic/quest=100');
        });

        it('returns classic domain for classic variant', () => {
            expect(getWowheadQuestUrl(100, 'classic')).toBe('https://www.wowhead.com/classic/quest=100');
        });

        // P1: apiNamespacePrefix support
        it('returns tbc domain for classicann prefix', () => {
            expect(getWowheadQuestUrl(100, 'classicann')).toBe('https://www.wowhead.com/tbc/quest=100');
        });

        it('returns classic domain for classic1x prefix', () => {
            expect(getWowheadQuestUrl(100, 'classic1x')).toBe('https://www.wowhead.com/classic/quest=100');
        });

        it('returns www domain for null prefix (retail)', () => {
            expect(getWowheadQuestUrl(100, null)).toBe('https://www.wowhead.com/quest=100');
            expect(getWowheadQuestUrl(100, undefined)).toBe('https://www.wowhead.com/quest=100');
        });
    });

    describe('getWowheadItemUrl', () => {
        it('returns correct domain for classicann prefix', () => {
            expect(getWowheadItemUrl(42, 'classicann')).toBe('https://www.wowhead.com/tbc/item=42');
        });

        it('returns correct domain for classic1x prefix', () => {
            expect(getWowheadItemUrl(42, 'classic1x')).toBe('https://www.wowhead.com/classic/item=42');
        });
    });

    describe('getWowheadDataSuffix', () => {
        it('returns tbc domain for classicann prefix', () => {
            expect(getWowheadDataSuffix('classicann')).toBe('domain=tbc');
        });

        it('returns classic domain for classic1x prefix', () => {
            expect(getWowheadDataSuffix('classic1x')).toBe('domain=classic&dataEnv=1');
        });
    });

    describe('getWowheadNpcSearchUrl', () => {
        it('returns correct domain for classicann prefix', () => {
            expect(getWowheadNpcSearchUrl('Onyxia', 'classicann')).toBe(
                'https://www.wowhead.com/tbc/search?q=Onyxia',
            );
        });

        it('returns correct domain for classic1x prefix', () => {
            expect(getWowheadNpcSearchUrl('Ragnaros', 'classic1x')).toBe(
                'https://www.wowhead.com/classic/search?q=Ragnaros',
            );
        });
    });
});

/**
 * ROK-1726 (operator ruling 2026-10-04): WoW: Forever now resolves to
 * Wowhead's Forever environment. This REPLACES the ROK-1563 Forever→classic
 * assertions per that ruling — a deliberate behaviour change, not a weakened
 * test.
 */
describe('wowhead urls — WoW: Forever uses /forever (ROK-1726)', () => {
    it.each(['wow_forever', 'classicforever'])('%s → www.wowhead.com/forever', (variant) => {
        expect(getWowheadItemUrl(19019, variant)).toBe('https://www.wowhead.com/forever/item=19019');
        expect(getWowheadQuestUrl(100, variant)).toBe('https://www.wowhead.com/forever/quest=100');
        expect(getWowheadNpcSearchUrl('Onyxia', variant)).toBe('https://www.wowhead.com/forever/search?q=Onyxia');
        expect(getWowheadTalentCalcUrl('Mage', variant)).toBe('https://www.wowhead.com/forever/talent-calc/mage');
    });

    it.each(['wow_forever', 'classicforever'])('%s → domain=forever tooltip data', (variant) => {
        expect(getWowheadItemData(234819, variant)).toBe('item=234819&domain=forever');
        expect(getWowheadQuestData(100, variant)).toBe('quest=100&domain=forever');
        expect(getWowheadDataSuffix(variant)).toBe('domain=forever');
    });

    it('resolves the forever loot expansion to the Forever environment', () => {
        expect(getWowheadItemUrlForExpansion(1, 'forever')).toBe('https://www.wowhead.com/forever/item=1');
        expect(getWowheadDataSuffixForExpansion('forever')).toBe('domain=forever');
    });
});

/**
 * ROK-1726 AC6 pin: every non-Forever variant, alias and absent value keeps
 * its pre-ROK-1726 Wowhead output byte-for-byte. Literal values, captured
 * from the switch this replaced — do not derive them from the config table.
 */
const RETAIL_ROW = {
    itemUrl: 'https://www.wowhead.com/item=42',
    itemData: 'item=42&domain=www',
    suffix: 'domain=www',
    questUrl: 'https://www.wowhead.com/quest=100',
    npcUrl: 'https://www.wowhead.com/search?q=Onyxia',
    talentUrl: 'https://www.wowhead.com/talent-calc/mage',
    embedUrl: 'https://www.wowhead.com/talent-calc/embed/mage/abc',
};
const CLASSIC_ROW = {
    itemUrl: 'https://www.wowhead.com/classic/item=42',
    itemData: 'item=42&domain=classic&dataEnv=1',
    suffix: 'domain=classic&dataEnv=1',
    questUrl: 'https://www.wowhead.com/classic/quest=100',
    npcUrl: 'https://www.wowhead.com/classic/search?q=Onyxia',
    talentUrl: 'https://www.wowhead.com/classic/talent-calc/mage',
    embedUrl: 'https://www.wowhead.com/classic/talent-calc/embed/mage/abc',
};
const TBC_ROW = {
    itemUrl: 'https://www.wowhead.com/tbc/item=42',
    itemData: 'item=42&domain=tbc',
    suffix: 'domain=tbc',
    questUrl: 'https://www.wowhead.com/tbc/quest=100',
    npcUrl: 'https://www.wowhead.com/tbc/search?q=Onyxia',
    talentUrl: 'https://www.wowhead.com/tbc/talent-calc/mage',
    embedUrl: 'https://www.wowhead.com/tbc/talent-calc/embed/mage/abc',
};

describe('wowhead urls — non-Forever pin (ROK-1726 AC6)', () => {
    it.each([
        ['retail', RETAIL_ROW],
        [null, RETAIL_ROW],
        [undefined, RETAIL_ROW],
        ['unknown', RETAIL_ROW],
        ['classic_era', CLASSIC_ROW],
        ['classic', CLASSIC_ROW],
        ['classic1x', CLASSIC_ROW],
        ['classic_anniversary', TBC_ROW],
        ['classicann', TBC_ROW],
    ] as const)('%j keeps its existing Wowhead output', (variant, row) => {
        expect({
            itemUrl: getWowheadItemUrl(42, variant),
            itemData: getWowheadItemData(42, variant),
            suffix: getWowheadDataSuffix(variant),
            questUrl: getWowheadQuestUrl(100, variant),
            npcUrl: getWowheadNpcSearchUrl('Onyxia', variant),
            talentUrl: getWowheadTalentCalcUrl('Mage', variant),
            embedUrl: getWowheadTalentCalcEmbedUrl('Mage', 'abc', variant),
        }).toEqual(row);
    });

    it.each([
        ['tbc', 'https://www.wowhead.com/tbc/item=1', 'domain=tbc'],
        ['wotlk', 'https://www.wowhead.com/wotlk/item=1', 'domain=wotlk'],
        ['cata', 'https://www.wowhead.com/cata/item=1', 'domain=cata'],
        ['sod', 'https://www.wowhead.com/classic/item=1', 'domain=classic&dataEnv=1'],
        ['classic', 'https://www.wowhead.com/classic/item=1', 'domain=classic&dataEnv=1'],
        ['unknown', 'https://www.wowhead.com/item=1', 'domain=www'],
        ['toString', 'https://www.wowhead.com/item=1', 'domain=www'],
    ])('expansion %s keeps its existing Wowhead output', (expansion, url, suffix) => {
        expect(getWowheadItemUrlForExpansion(1, expansion)).toBe(url);
        expect(getWowheadDataSuffixForExpansion(expansion)).toBe(suffix);
    });
});
