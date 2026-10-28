/**
 * ROK-1837 D4/D7 — decode a fog layer and build its RGBA pixels.
 *
 * The fog route returns the stored gzip member (CONTRACT §4: packed bitset,
 * LSB first, `py = 0` south). The browser inflates it with
 * `DecompressionStream('gzip')`; where that API is missing the decode fails
 * with a typed `unsupported` error (the view shows its error state) rather
 * than shipping an inflate library (D5: no new dependency).
 */
import { valheimLinkBitmapBytes } from '@raid-ledger/contract';
import { bitIndex, isBitSet, textureRowFor } from './valheim-grid';
import type { Bounds } from './map-viewport.math';

/** Unexplored fog opacity (D7). Fully opaque: no terrain may show through (ROK-1949). */
export const FOG_ALPHA_UNEXPLORED = 1;
/** Opacity of pixels explored only by the shared cartography layer (D7, AC2). */
export const FOG_ALPHA_SHARED_ONLY = 0.45;

export type FogDecodeReason = 'unsupported' | 'corrupt' | 'length';

export class FogDecodeError extends Error {
    readonly reason: FogDecodeReason;
    constructor(reason: FogDecodeReason, message: string) {
        super(message);
        Object.setPrototypeOf(this, FogDecodeError.prototype);
        this.name = 'FogDecodeError';
        this.reason = reason;
    }
}

export type DecompressionCtor = new (
    format: 'gzip',
) => TransformStream<Uint8Array, Uint8Array>;

function defaultDecompression(): DecompressionCtor | null {
    const ctor = (globalThis as { DecompressionStream?: unknown })
        .DecompressionStream;
    return typeof ctor === 'function' ? (ctor as DecompressionCtor) : null;
}

async function readAll(
    stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

/** Gunzip `bytes`. Pass `null` as `ctor` to exercise the no-API path. */
export async function inflateGzip(
    bytes: Uint8Array,
    ctor: DecompressionCtor | null = defaultDecompression(),
): Promise<Uint8Array> {
    if (!ctor)
        throw new FogDecodeError(
            'unsupported',
            'This browser cannot decompress the map fog.',
        );
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
    try {
        return await readAll(source.pipeThrough(new ctor('gzip')));
    } catch {
        throw new FogDecodeError('corrupt', 'The map fog data is damaged.');
    }
}

/** Inflate one fog layer and check it is exactly `⌈size²/8⌉` bytes. */
export async function decodeFogBitset(
    gzip: Uint8Array,
    textureSize: number,
    ctor: DecompressionCtor | null = defaultDecompression(),
): Promise<Uint8Array> {
    const bits = await inflateGzip(gzip, ctor);
    const expected = valheimLinkBitmapBytes(textureSize, textureSize);
    if (bits.length !== expected) {
        throw new FogDecodeError(
            'length',
            `Fog layer is ${bits.length} bytes, expected ${expected}.`,
        );
    }
    return bits;
}

export interface FogRgb {
    r: number;
    g: number;
    b: number;
}

/**
 * RGBA pixels (`size² · 4`, canvas row 0 = north) for an `ImageData`: alpha 0
 * where the personal layer is explored, {@link FOG_ALPHA_SHARED_ONLY} where
 * only `shared` is (pass `null` while the toggle is off), else
 * {@link FOG_ALPHA_UNEXPLORED}. `rgb` is the theme's `--color-backdrop`.
 */
export function buildFogPixels(
    size: number,
    personal: Uint8Array,
    shared: Uint8Array | null,
    rgb: FogRgb,
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(size * size * 4);
    const unexplored = Math.round(FOG_ALPHA_UNEXPLORED * 255);
    const sharedOnly = Math.round(FOG_ALPHA_SHARED_ONLY * 255);
    for (let py = 0; py < size; py++) {
        const rowStart = textureRowFor(size, py) * size;
        for (let px = 0; px < size; px++) {
            const i = bitIndex(size, px, py);
            const o = (rowStart + px) * 4;
            out[o] = rgb.r;
            out[o + 1] = rgb.g;
            out[o + 2] = rgb.b;
            if (isBitSet(personal, i)) out[o + 3] = 0;
            else
                out[o + 3] =
                    shared && isBitSet(shared, i) ? sharedOnly : unexplored;
        }
    }
    return out;
}

/** The first set bit in `[from, to)`, or -1; whole zero bytes are skipped. */
function firstSetBit(bits: Uint8Array, from: number, to: number): number {
    for (let i = from; i < to; ) {
        const v = bits[i >> 3] ?? 0;
        if (v === 0) i = (i | 7) + 1;
        else if (((v >> (i & 7)) & 1) === 1) return i;
        else i++;
    }
    return -1;
}

/** The last set bit in `[from, to)`, or -1; whole zero bytes are skipped. */
function lastSetBit(bits: Uint8Array, from: number, to: number): number {
    for (let i = to - 1; i >= from; ) {
        const v = bits[i >> 3] ?? 0;
        if (v === 0) i = (i & ~7) - 1;
        else if (((v >> (i & 7)) & 1) === 1) return i;
        else i--;
    }
    return -1;
}

const rowHasBit = (bits: Uint8Array, size: number, py: number): boolean =>
    firstSetBit(bits, py * size, (py + 1) * size) >= 0;

/**
 * ROK-2028 — the bounding box of the set bits of a fog bitset (`size²` bits,
 * LSB first, `py = 0` south), flipped to canvas rows so it lines up with the
 * texture layer (max exclusive); null when nothing is explored. Row-scanning
 * (it runs in render): the first/last non-empty row, then per row only the
 * bits outside the box found so far, zero bytes skipped — never every set bit.
 */
export function exploredBounds(size: number, bits: Uint8Array): Bounds | null {
    let minPy = 0;
    while (minPy < size && !rowHasBit(bits, size, minPy)) minPy++;
    if (minPy >= size) return null;
    let maxPy = size - 1;
    while (maxPy > minPy && !rowHasBit(bits, size, maxPy)) maxPy--;
    let minPx = size;
    let maxPx = -1;
    for (let py = minPy; py <= maxPy; py++) {
        const row = py * size;
        const first = firstSetBit(bits, row, row + minPx);
        if (first >= 0) minPx = first - row;
        const last = lastSetBit(bits, row + maxPx + 1, row + size);
        if (last >= 0) maxPx = last - row;
    }
    return {
        minX: minPx,
        maxX: maxPx + 1,
        minY: textureRowFor(size, maxPy),
        maxY: textureRowFor(size, minPy) + 1,
    };
}
