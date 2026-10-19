/**
 * ROK-1837 D6 — the one place that maps Valheim world metres onto the minimap
 * texture and the fog bitset. Every constant is read from the map's `grid`
 * (CONTRACT §4: `textureSize`, `pixelSizeMetres` are UNVERIFIED and the mod
 * sends them), never hardcoded (M-Q10).
 *
 * Texture space: `px = x / pixelSize + size/2`, `py = z / pixelSize + size/2`,
 * `py = 0` is the SOUTH edge. Screen space flips it: north is up.
 */
import type { ValheimMapGrid } from '@raid-ledger/contract';

export interface TexturePoint {
    px: number;
    py: number;
}

/** World metres (x east, z north) → continuous texture pixels (py = 0 south). */
export function worldToTexture(
    grid: ValheimMapGrid,
    x: number,
    z: number,
): TexturePoint {
    const half = grid.textureSize / 2;
    return {
        px: x / grid.pixelSizeMetres + half,
        py: z / grid.pixelSizeMetres + half,
    };
}

/** Integer texture row `py` → the screen/canvas row it paints on (row 0 = north). */
export function textureRowFor(textureSize: number, py: number): number {
    return textureSize - 1 - py;
}

/** World metres → continuous screen-space texture pixels (left, top) for a pin. */
export function worldToScreen(
    grid: ValheimMapGrid,
    x: number,
    z: number,
): { left: number; top: number } {
    const { px, py } = worldToTexture(grid, x, z);
    return { left: px, top: grid.textureSize - py };
}

/** Bitset bit index of pixel (px, py) in a `width`-wide mask. */
export function bitIndex(width: number, px: number, py: number): number {
    return py * width + px;
}

/** Bit `i` of a packed LSB-first bitset (`byte i >> 3`, `bit i & 7`). */
export function isBitSet(bits: Uint8Array, i: number): boolean {
    return (((bits[i >> 3] ?? 0) >> (i & 7)) & 1) === 1;
}
