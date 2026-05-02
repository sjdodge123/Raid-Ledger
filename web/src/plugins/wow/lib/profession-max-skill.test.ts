/**
 * Vitest — profession-max-skill (ROK-1179 follow-up to ROK-1130).
 *
 * Pins the era → cap table for every era plus the unknown-slug fallback.
 */
import { describe, it, expect } from 'vitest';
import { getMaxProfessionSkill } from './profession-max-skill';

describe('getMaxProfessionSkill — per-era caps', () => {
    it.each<[string, number]>([
        ['world-of-warcraft-classic', 300],
        ['world-of-warcraft-classic-season-of-discovery', 300],
        ['world-of-warcraft-burning-crusade-classic', 375],
        ['world-of-warcraft-burning-crusade-classic-anniversary-edition', 375],
        ['world-of-warcraft-wrath-of-the-lich-king-classic', 450],
        ['world-of-warcraft-cataclysm-classic', 525],
        ['world-of-warcraft-mists-of-pandaria-classic', 600],
    ])('returns the right cap for %s', (slug, cap) => {
        expect(getMaxProfessionSkill(slug)).toBe(cap);
    });
});

describe('getMaxProfessionSkill — fallback to retail (cap 100)', () => {
    it('returns 100 for null', () => {
        expect(getMaxProfessionSkill(null)).toBe(100);
    });

    it('returns 100 for undefined', () => {
        expect(getMaxProfessionSkill(undefined)).toBe(100);
    });

    it('returns 100 for an unknown slug', () => {
        expect(getMaxProfessionSkill('world-of-warcraft-future-x')).toBe(100);
    });
});
