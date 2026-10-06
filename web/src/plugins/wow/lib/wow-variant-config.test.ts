import { describe, it, expect } from 'vitest';
import { WowGameVariantSchema } from '@raid-ledger/contract';
import {
    WOW_VARIANT_INTEGRATIONS,
    WOWHEAD_EXPANSION_DOMAINS,
    normalizeWowVariant,
    getWowVariantIntegrations,
    resolveWowVariant,
    getWowVariantLabel,
    slugToContentVariant,
} from './wow-variant-config';

describe('WOW_VARIANT_INTEGRATIONS (ROK-1726)', () => {
    it('has exactly one row per contract WowGameVariantSchema option', () => {
        expect(Object.keys(WOW_VARIANT_INTEGRATIONS).sort()).toEqual([...WowGameVariantSchema.options].sort());
    });

    it('uses the Wowhead Forever environment for wow_forever only', () => {
        const foreverRows = Object.entries(WOW_VARIANT_INTEGRATIONS)
            .filter(([, row]) => row.wowhead.tooltipDomain === 'forever' || row.wowhead.urlBase.endsWith('/forever'))
            .map(([key]) => key);
        expect(foreverRows).toEqual(['wow_forever']);
    });

    it('marks only wow_forever as not importable from the Armory', () => {
        const unsupported = Object.entries(WOW_VARIANT_INTEGRATIONS)
            .filter(([, row]) => !row.armoryImport)
            .map(([key]) => key);
        expect(unsupported).toEqual(['wow_forever']);
    });

    it('adds a forever expansion domain alongside the verbatim classic ones', () => {
        expect(WOWHEAD_EXPANSION_DOMAINS.forever).toEqual({ urlBase: 'www.wowhead.com/forever', tooltipDomain: 'forever' });
        expect(WOWHEAD_EXPANSION_DOMAINS.sod).toEqual({ urlBase: 'www.wowhead.com/classic', tooltipDomain: 'classic&dataEnv=1' });
    });
});

describe('normalizeWowVariant', () => {
    it.each([
        ['retail', 'retail'],
        ['classic_era', 'classic_era'],
        ['classic1x', 'classic_era'],
        ['classic', 'classic'],
        ['classic_anniversary', 'classic_anniversary'],
        ['classicann', 'classic_anniversary'],
        ['wow_forever', 'wow_forever'],
        ['classicforever', 'wow_forever'],
        ['unknown', null],
        ['', null],
        [null, null],
        [undefined, null],
    ])('%j → %j', (input, expected) => {
        expect(normalizeWowVariant(input)).toBe(expected);
    });

    it('returns the integrations row through an alias', () => {
        expect(getWowVariantIntegrations('classicforever')).toBe(WOW_VARIANT_INTEGRATIONS.wow_forever);
        expect(getWowVariantIntegrations('nope')).toBeNull();
    });
});

describe('resolveWowVariant (D6)', () => {
    it.each([
        [{ gameVariant: 'wow_forever' }, 'wow_forever'],
        [{ gameVariant: 'classicforever', ruleset: null }, 'wow_forever'],
        [{ gameVariant: null, ruleset: 'pvp' }, 'wow_forever'],
        [{ gameVariant: undefined, ruleset: 'normal' }, 'wow_forever'],
        [{ gameVariant: 'unknown', ruleset: 'pvp' }, 'wow_forever'],
        [{ gameVariant: 'classic_era', ruleset: 'pvp' }, 'classic_era'],
        [{ gameVariant: 'retail' }, 'retail'],
        [{ gameVariant: null, ruleset: null }, null],
        [{}, null],
    ])('%j → %j', (character, expected) => {
        expect(resolveWowVariant(character)).toBe(expected);
    });
});

describe('getWowVariantLabel', () => {
    it.each([
        ['retail', null],
        ['classic_era', 'Era'],
        ['classic1x', 'Era'],
        ['classic', 'Cata'],
        ['classic_anniversary', 'TBC'],
        ['wow_forever', 'Forever'],
        ['classicforever', 'Forever'],
        [null, null],
        ['unknown', null],
    ])('%j → %j', (variant, expected) => {
        expect(getWowVariantLabel(variant)).toBe(expected);
    });
});

describe('slugToContentVariant (verbatim move, OQ4)', () => {
    it.each([
        ['wow-classic-anniversary', 'classic_anniversary'],
        ['world-of-warcraft-burning-crusade-classic-anniversary-edition', 'classic_anniversary'],
        ['world-of-warcraft-classic', 'classic_era'],
        ['wow-classic-era', 'classic_era'],
        ['wow-classic', 'classic'],
        ['wow-cata', 'classic'],
        ['world-of-warcraft-burning-crusade-classic', 'classic'],
        ['world-of-warcraft-wrath-of-the-lich-king', 'classic'],
        ['wow-retail', 'retail'],
        ['world-of-warcraft', 'retail'],
        ['world-of-warcraft-forever', 'wow_forever'],
        ['something-else', 'classic_era'],
        [undefined, 'classic_era'],
    ])('%j → %j', (slug, expected) => {
        expect(slugToContentVariant(slug)).toBe(expected);
    });
});
