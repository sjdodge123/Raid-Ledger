import { describe, expect, it } from 'vitest';
import { getContentType } from './event-content-type';

describe('getContentType (core, ROK-2359)', () => {
    it.each([
        ['classic-40-raid', 'raid'],
        ['raid', 'raid'],
        ['classic-dungeon', 'dungeon'],
        ['mythic-plus', 'dungeon'],
    ] as const)('%s → %s', (slug, expected) => {
        expect(getContentType(slug)).toBe(expected);
    });

    it('returns null for a slug that names no instance content', () => {
        expect(getContentType('delve')).toBeNull();
        expect(getContentType('pvp')).toBeNull();
    });
});
