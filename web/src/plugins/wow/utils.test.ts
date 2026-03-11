import { describe, it, expect } from 'vitest';
import { getWowVariant, getContentType, isWowSlug, WOW_SLUGS } from './utils';

describe('getWowVariant', () => {
    it('returns retail for world-of-warcraft', () => {
        expect(getWowVariant('world-of-warcraft')).toBe('retail');
    });

    it('returns classic_era for world-of-warcraft-classic (Classic Era)', () => {
        expect(getWowVariant('world-of-warcraft-classic')).toBe('classic_era');
    });

    it('returns classic_anniversary for burning-crusade-classic-anniversary-edition', () => {
        expect(getWowVariant('world-of-warcraft-burning-crusade-classic-anniversary-edition')).toBe('classic_anniversary');
    });

    it('returns classic for burning-crusade-classic', () => {
        expect(getWowVariant('world-of-warcraft-burning-crusade-classic')).toBe('classic');
    });

    it('returns classic for wrath-of-the-lich-king', () => {
        expect(getWowVariant('world-of-warcraft-wrath-of-the-lich-king')).toBe('classic');
    });

    it('returns null for non-WoW slugs', () => {
        expect(getWowVariant('valheim')).toBeNull();
        expect(getWowVariant('final-fantasy-xiv-online')).toBeNull();
    });
});

describe('isWowSlug', () => {
    it('returns true for all WoW slugs', () => {
        expect(isWowSlug('world-of-warcraft')).toBe(true);
        expect(isWowSlug('world-of-warcraft-classic')).toBe(true);
        expect(isWowSlug('world-of-warcraft-burning-crusade-classic-anniversary-edition')).toBe(true);
        expect(isWowSlug('world-of-warcraft-burning-crusade-classic')).toBe(true);
        expect(isWowSlug('world-of-warcraft-wrath-of-the-lich-king')).toBe(true);
    });

    it('returns false for non-WoW slugs', () => {
        expect(isWowSlug('valheim')).toBe(false);
        expect(isWowSlug('final-fantasy-xiv-online')).toBe(false);
    });
});

describe('WOW_SLUGS', () => {
    it('contains all 5 WoW game slugs', () => {
        expect(WOW_SLUGS.size).toBe(5);
    });
});

describe('getContentType', () => {
    it('returns raid for raid slugs', () => {
        expect(getContentType('classic-40-raid')).toBe('raid');
    });

    it('returns dungeon for dungeon slugs', () => {
        expect(getContentType('classic-dungeon')).toBe('dungeon');
    });

    it('returns dungeon for mythic-plus', () => {
        expect(getContentType('mythic-plus')).toBe('dungeon');
    });

    it('returns null for unrecognized slugs', () => {
        expect(getContentType('delve')).toBeNull();
    });
});
