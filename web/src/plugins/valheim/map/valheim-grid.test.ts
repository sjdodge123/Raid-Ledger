import { describe, expect, it } from 'vitest';
import {
    bitIndex,
    isBitSet,
    textureRowFor,
    worldToScreen,
    worldToTexture,
} from './valheim-grid';

const vanilla = { textureSize: 2048, pixelSizeMetres: 12 };
const small = { textureSize: 1024, pixelSizeMetres: 6 };

describe('worldToTexture (D6)', () => {
    it('maps the world origin to the texture centre', () => {
        expect(worldToTexture(vanilla, 0, 0)).toEqual({ px: 1024, py: 1024 });
    });

    it('moves 10 pixels east for 10 pixel-widths of x', () => {
        expect(worldToTexture(vanilla, 12 * 10, 0).px).toBe(1024 + 10);
    });

    it('puts the south edge (most negative z) on py 0, which paints on the bottom row', () => {
        const { py } = worldToTexture(vanilla, 0, (-2048 / 2) * 12);
        expect(py).toBe(0);
        expect(textureRowFor(2048, py)).toBe(2047);
    });

    it('reads the constants from the grid it is given (1024 / 6 m)', () => {
        expect(worldToTexture(small, 60, -60)).toEqual({ px: 522, py: 502 });
        expect(textureRowFor(1024, 0)).toBe(1023);
    });

    it('places north pins above south pins on screen', () => {
        const north = worldToScreen(vanilla, 0, 1200);
        const south = worldToScreen(vanilla, 0, -1200);
        expect(north.top).toBe(924);
        expect(south.top).toBe(1124);
    });
});

describe('bitIndex / isBitSet (LSB first)', () => {
    it('reads a hand-built 16×16 bitset LSB-first, py 0 first', () => {
        const bits = new Uint8Array(32);
        bits[0] = 0b0000_0001; // (0, 0)
        bits[2] = 0b1000_0000; // bit 23 → (7, 1)
        expect(bitIndex(16, 7, 1)).toBe(23);
        expect(isBitSet(bits, bitIndex(16, 0, 0))).toBe(true);
        expect(isBitSet(bits, bitIndex(16, 7, 1))).toBe(true);
        expect(isBitSet(bits, bitIndex(16, 1, 0))).toBe(false);
        expect(isBitSet(bits, bitIndex(16, 0, 1))).toBe(false);
    });
});
