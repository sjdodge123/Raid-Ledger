import { describe, expect, it } from 'vitest';
import type { ValheimMapGrid } from '@raid-ledger/contract';
import {
    chestFocusHash,
    chestFocusQuery,
    chestMarkerPoint,
    formatFocusCoord,
    parseChestFocus,
} from './chest-focus';
import { worldToScreen } from './valheim-grid';

const GRID: ValheimMapGrid = { textureSize: 256, pixelSizeMetres: 12 };
const IRON = { prefab: 'piece_chest_wood', x: -271, z: 75, item: 'Iron' };

describe('chest focus deep link (ROK-1889)', () => {
    it('round-trips a chest through the #map hash', () => {
        const hash = chestFocusHash(IRON);
        expect(hash.startsWith('#map?')).toBe(true);
        expect(parseChestFocus(hash)).toEqual(IRON);
        expect(
            parseChestFocus(chestFocusHash({ ...IRON, item: null })),
        ).toEqual({ ...IRON, item: null });
    });

    it('rounds positions to 0.1 m (the chest identity grain)', () => {
        expect(formatFocusCoord(-271.04)).toBe('-271.0');
        expect(formatFocusCoord(12.36)).toBe('12.4');
        expect(formatFocusCoord(-0.01)).toBe('0.0');
        expect(chestFocusQuery({ ...IRON, x: 1.26 })).toBe(
            'prefab=piece_chest_wood&x=1.3&z=75.0&item=Iron',
        );
    });

    it.each([
        '',
        '#map',
        '#materials?focus=chest:piece_chest@1,2',
        '#map?focus=chest:piece chest@1,2',
        '#map?focus=chest:piece_chest@1',
        '#map?focus=chest:piece_chest@1e3,2',
        '#map?focus=pin:piece_chest@1,2',
    ])('ignores %j', (hash) => {
        expect(parseChestFocus(hash)).toBeNull();
    });

    it('drops a malformed item but keeps the chest', () => {
        const hash = '#map?focus=chest%3Apiece_chest%401.5%2C-2&item=%3Cb%3E';
        expect(parseChestFocus(hash)).toEqual({
            prefab: 'piece_chest',
            x: 1.5,
            z: -2,
            item: null,
        });
    });

    it('projects with the ROK-1880 pin projection', () => {
        const { left, top } = worldToScreen(GRID, -271, 75);
        expect(chestMarkerPoint(GRID, -271, 75)).toEqual({ x: left, y: top });
        // World origin is the texture centre; north (+z) is up the texture.
        expect(chestMarkerPoint(GRID, 0, 0)).toEqual({ x: 128, y: 128 });
        expect(chestMarkerPoint(GRID, 0, 120).y).toBeLessThan(128);
    });
});
