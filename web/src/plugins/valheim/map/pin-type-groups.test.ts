import { describe, expect, it } from 'vitest';
import {
    PIN_TYPE_GROUP_IDS,
    PIN_TYPE_GROUPS,
    groupOf,
    isPinTypeGroupId,
    rawTypesFor,
} from './pin-type-groups';

describe('pin type groups (ROK-1943 D7/D8, Q2 = a)', () => {
    it('lists all 12 chips in the ruled fixed order, Scanned portals right after Portal', () => {
        expect(PIN_TYPE_GROUP_IDS).toEqual([
            'death', 'bed', 'portal', 'scanned-portal', 'boss', 'home', 'fire',
            'workshop', 'mine', 'shout', 'hildir', 'other',
        ]);
        expect(PIN_TYPE_GROUPS.map((g) => g.label)).toEqual([
            'Death', 'Bed', 'Portal', 'Scanned portals', 'Boss', 'Home', 'Fire',
            'Workshop', 'Mine', 'Shout', "Hildir's chest", 'Other',
        ]);
    });

    it('every entry has an icon and a tone token; only Scanned portals is the portal-scan source', () => {
        expect(PIN_TYPE_GROUPS.filter((g) => g.source !== 'map').map((g) => [g.id, g.source]))
            .toEqual([['scanned-portal', 'portal-scan']]);
        for (const g of PIN_TYPE_GROUPS) {
            expect(g.Icon).toBeTruthy();
            expect(g.toneClass).toMatch(/^text-/);
        }
    });

    it('S12: groupOf maps raw types to their chip; unknown and modded types are Other', () => {
        expect(groupOf('Icon4')).toBe('portal');
        expect(groupOf('Hildir2')).toBe('hildir');
        expect(groupOf('Death')).toBe('death');
        expect(groupOf('Icon3')).toBe('mine');
        expect(groupOf('Modded_X')).toBe('other');
        expect(groupOf('17')).toBe('other');
        expect(groupOf('constructor')).toBe('other');
    });

    it('match() agrees with groupOf()', () => {
        const portal = PIN_TYPE_GROUPS.find((g) => g.id === 'portal');
        const other = PIN_TYPE_GROUPS.find((g) => g.id === 'other');
        expect(portal?.match('Icon4')).toBe(true);
        expect(portal?.match('Icon3')).toBe(false);
        expect(other?.match('Modded_X')).toBe(true);
        expect(other?.match('Bed')).toBe(false);
    });

    it('S12: rawTypesFor lists the raw types in registry order; Other or all → undefined', () => {
        expect(rawTypesFor(['portal', 'death'])).toEqual(['Death', 'Icon4']);
        expect(rawTypesFor(new Set(['hildir'] as const))).toEqual(['Hildir1', 'Hildir2', 'Hildir3']);
        expect(rawTypesFor(['death', 'other'])).toBeUndefined();
        expect(rawTypesFor(null)).toBeUndefined();
    });

    it('ROK-1946 D11/D13: no raw type maps to Scanned portals and it sends no raw types', () => {
        expect(groupOf('Icon4')).toBe('portal');
        for (const raw of ['Icon4', 'rl:scanned-portal', 'Bed', '17']) expect(groupOf(raw)).not.toBe('scanned-portal');
        expect(PIN_TYPE_GROUPS.find((g) => g.id === 'scanned-portal')?.match('Icon4')).toBe(false);
        expect(rawTypesFor(['scanned-portal'])).toEqual([]);
        expect(rawTypesFor(['scanned-portal', 'death'])).toEqual(['Death']);
    });

    it('isPinTypeGroupId narrows only the known ids', () => {
        expect(isPinTypeGroupId('portal')).toBe(true);
        expect(isPinTypeGroupId('scanned-portal')).toBe(true);
        expect(isPinTypeGroupId('nope')).toBe(false);
        expect(isPinTypeGroupId('toString')).toBe(false);
    });
});
