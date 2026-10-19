import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { valheimLinkBitmapBytes } from '@raid-ledger/contract';
import {
    FOG_ALPHA_SHARED_ONLY,
    FOG_ALPHA_UNEXPLORED,
    FogDecodeError,
    buildFogPixels,
    decodeFogBitset,
    inflateGzip,
} from './fog-bitmap';

const FIXTURE = new URL('../../../../../packages/contract/valheim-link/v1/fixtures/map-personal.json', import.meta.url);

function fixtureGzip(): { bytes: Uint8Array; size: number } {
    const msg = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { grid: { textureSize: number }; explored: { data: string } };
    return { bytes: new Uint8Array(Buffer.from(msg.explored.data, 'base64')), size: msg.grid.textureSize };
}

async function gzip(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    const stream = new ReadableStream<BufferSource>({ start(c) { c.enqueue(raw); c.close(); } });
    return new Uint8Array(await new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

const alphaAt = (px: Uint8ClampedArray, size: number, col: number, row: number) => px[(row * size + col) * 4 + 3];
const rgb = { r: 2, g: 6, b: 23 };

describe('decodeFogBitset (D4)', () => {
    it('inflates the contract fixture to exactly ⌈size²/8⌉ bytes', async () => {
        const { bytes, size } = fixtureGzip();
        const bits = await decodeFogBitset(bytes, size);
        expect(bits.length).toBe(valheimLinkBitmapBytes(size, size));
    });

    it('rejects a layer whose inflated length does not match the grid', async () => {
        const wrong = await gzip(new Uint8Array(100));
        await expect(decodeFogBitset(wrong, 64)).rejects.toMatchObject({ reason: 'length' });
    });

    it('rejects a truncated gzip member as corrupt', async () => {
        const good = await gzip(new Uint8Array(512).fill(0xff));
        const err = await decodeFogBitset(good.slice(0, good.length - 12), 64).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(FogDecodeError);
        expect(err).toMatchObject({ reason: 'corrupt' });
    });

    it('fails with a typed unsupported error when DecompressionStream is unavailable', async () => {
        await expect(inflateGzip(new Uint8Array([0x1f, 0x8b]), null)).rejects.toMatchObject({ reason: 'unsupported' });
    });
});

describe('buildFogPixels (D7)', () => {
    const size = 16;
    const personal = new Uint8Array(32);
    personal[0] = 0b0000_0001; // (0, 0) explored — south-west corner
    const shared = new Uint8Array(32);
    shared[0] = 0b0000_0011; // (0, 0) and (1, 0)

    it('clears explored pixels and paints py 0 on the bottom canvas row', () => {
        const px = buildFogPixels(size, personal, null, rgb);
        expect(alphaAt(px, size, 0, 15)).toBe(0);
        expect(alphaAt(px, size, 0, 0)).toBe(Math.round(FOG_ALPHA_UNEXPLORED * 255));
        expect(alphaAt(px, size, 1, 15)).toBe(Math.round(FOG_ALPHA_UNEXPLORED * 255));
        expect(Array.from(px.slice(0, 3))).toEqual([2, 6, 23]);
    });

    it('paints shared-only pixels at the lighter shared alpha while the layer is on', () => {
        const px = buildFogPixels(size, personal, shared, rgb);
        expect(alphaAt(px, size, 1, 15)).toBe(Math.round(FOG_ALPHA_SHARED_ONLY * 255));
        expect(alphaAt(px, size, 0, 15)).toBe(0);
    });
});
