import { describe, expect, it } from 'vitest';
import { cleanPinLabel } from './pin-label';

describe('cleanPinLabel (ROK-1880)', () => {
    it('keeps a plain player label', () => {
        expect(cleanPinLabel('Copper vein', 'Mine')).toBe('Copper vein');
    });

    it('strips Unity rich-text tags', () => {
        expect(
            cleanPinLabel('<color=yellow><b>Base</b></color>', 'Home'),
        ).toBe('Base');
        expect(cleanPinLabel('<size=20>Big</size> camp', 'Home')).toBe(
            'Big camp',
        );
    });

    it('maps $hud_mapday N to "Day N"', () => {
        expect(cleanPinLabel('$hud_mapday 12', 'Death')).toBe('Day 12');
        expect(cleanPinLabel('<color=red>$hud_mapday 3</color>', 'Death')).toBe(
            'Day 3',
        );
    });

    it('title-cases $enemy_ / $location_ / $piece_ tokens', () => {
        expect(cleanPinLabel('$enemy_eikthyr', 'Boss')).toBe('Eikthyr');
        expect(cleanPinLabel('$enemy_gdking', 'Boss')).toBe('Gdking');
        expect(cleanPinLabel('$location_hildir_cave', "Hildir's chest")).toBe(
            'Hildir Cave',
        );
        expect(cleanPinLabel('$piece_portal_wood', 'Portal')).toBe(
            'Portal Wood',
        );
    });

    it('falls back to the type label for any other $token', () => {
        expect(cleanPinLabel('$hud_pin_shout', 'Shout')).toBe('Shout');
        expect(cleanPinLabel('$some_unknown', 'Map pin')).toBe('Map pin');
    });

    it('falls back to the type label for a blank or tag-only label', () => {
        expect(cleanPinLabel('   ', 'Death')).toBe('Death');
        expect(cleanPinLabel('<b></b>', 'Fire')).toBe('Fire');
    });
});
