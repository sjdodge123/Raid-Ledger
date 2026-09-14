/**
 * Vitest — wow-era (ROK-1179 follow-up to ROK-1130).
 *
 * Pins every entry of the slug → era map and every fallback branch.
 * Era derivation is the foundation for profession-max-skill and
 * profession-categories, so a missed branch here cascades.
 */
import { describe, it, expect } from 'vitest';
import {
    getWowEra,
    FIXED_CLASSIC_VARIANTS,
    SLUG_VARIANT_MAP,
    WOW_FOREVER_LABEL,
    type WowEra,
} from './wow-era';

describe('getWowEra — known slugs', () => {
    it.each<[string, WowEra]>([
        ['world-of-warcraft-classic', 'vanilla'],
        ['world-of-warcraft-classic-season-of-discovery', 'vanilla'],
        ['world-of-warcraft-burning-crusade-classic', 'bc'],
        ['world-of-warcraft-burning-crusade-classic-anniversary-edition', 'bc'],
        ['world-of-warcraft-wrath-of-the-lich-king-classic', 'wrath'],
        ['world-of-warcraft-cataclysm-classic', 'cataclysm'],
        ['world-of-warcraft-mists-of-pandaria-classic', 'mop'],
        ['world-of-warcraft-forever', 'vanilla'],
    ])('maps %s → %s', (slug, era) => {
        expect(getWowEra(slug)).toBe(era);
    });
});

describe('getWowEra — fallbacks default to retail', () => {
    it('returns retail for null', () => {
        expect(getWowEra(null)).toBe('retail');
    });

    it('returns retail for undefined', () => {
        expect(getWowEra(undefined)).toBe('retail');
    });

    it('returns retail for empty string', () => {
        expect(getWowEra('')).toBe('retail');
    });

    it('returns retail for unknown slug', () => {
        expect(getWowEra('world-of-warcraft-some-future-expansion')).toBe('retail');
    });

    it('returns retail for the canonical retail slug (not in the map by design)', () => {
        // The map intentionally omits a "retail" key — anything not in the
        // table falls through to the `retail` default. This pins that
        // contract so an editor doesn't add a retail entry that would
        // change the meaning of "unknown".
        expect(getWowEra('world-of-warcraft')).toBe('retail');
    });
});

/** ROK-1563: WoW: Forever variant wiring. */
describe('wow_forever (ROK-1563)', () => {
    it('maps the Forever slug to the wow_forever variant', () => {
        expect(SLUG_VARIANT_MAP['world-of-warcraft-forever']).toBe('wow_forever');
    });

    it('is a fixed-variant Classic slug (no selector needed)', () => {
        expect(FIXED_CLASSIC_VARIANTS['world-of-warcraft-forever']).toBe('wow_forever');
    });

    it('never resolves to the retail variant', () => {
        expect(SLUG_VARIANT_MAP['world-of-warcraft-forever']).not.toBe('retail');
        expect(getWowEra('world-of-warcraft-forever')).not.toBe('retail');
    });

    it('exports one picker label flagging the pending Blizzard namespace', () => {
        expect(WOW_FOREVER_LABEL).toContain('Forever');
        expect(WOW_FOREVER_LABEL).toContain('pending');
    });

    it('leaves the existing slug mappings untouched (AC4)', () => {
        expect(SLUG_VARIANT_MAP['world-of-warcraft']).toBe('retail');
        expect(SLUG_VARIANT_MAP['world-of-warcraft-classic']).toBe('classic_era');
        expect(
            SLUG_VARIANT_MAP['world-of-warcraft-burning-crusade-classic-anniversary-edition'],
        ).toBe('classic_anniversary');
    });
});
