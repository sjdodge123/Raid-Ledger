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

/** Unexplored fog opacity (D7). */
export const FOG_ALPHA_UNEXPLORED = 0.92;
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

export type DecompressionCtor = new (format: 'gzip') => TransformStream<Uint8Array, Uint8Array>;

function defaultDecompression(): DecompressionCtor | null {
    const ctor = (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
    return typeof ctor === 'function' ? (ctor as DecompressionCtor) : null;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
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
    if (!ctor) throw new FogDecodeError('unsupported', 'This browser cannot decompress the map fog.');
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
        throw new FogDecodeError('length', `Fog layer is ${bits.length} bytes, expected ${expected}.`);
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
            else out[o + 3] = shared && isBitSet(shared, i) ? sharedOnly : unexplored;
        }
    }
    return out;
}
