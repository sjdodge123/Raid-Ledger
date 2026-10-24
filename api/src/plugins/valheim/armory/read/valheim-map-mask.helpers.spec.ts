import { gzipSync } from 'node:zlib';
import {
  BaseMapMaskError,
  inflateBitset,
  maskEtag,
  maskFingerprint,
  maskRgbaInPlace,
  unionBitsets,
  type MaskFingerprintInput,
} from './valheim-map-mask.helpers';

const N = 64;

function bitsWith(points: readonly [number, number][]): Uint8Array {
  const bits = new Uint8Array((N * N) / 8);
  for (const [px, py] of points) {
    const i = py * N + px;
    bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7));
  }
  return bits;
}

function bitmapOf(bits: Uint8Array, n = N) {
  return { width: n, height: n, data: gzipSync(bits).toString('base64') };
}

/** Distinct non-zero RGBA per pixel so a moved/missed pixel is visible. */
function sourceRgba(): Uint8Array {
  const raw = new Uint8Array(N * N * 4);
  for (let p = 0; p < N * N; p += 1) {
    raw.set([(p % 251) + 1, ((p >> 3) % 251) + 1, 200, 255], p * 4);
  }
  return raw;
}

function pixel(raw: Uint8Array, px: number, row: number): number[] {
  const o = (row * N + px) * 4;
  return Array.from(raw.subarray(o, o + 4));
}

describe('maskRgbaInPlace', () => {
  it('keeps an explored pixel byte-identical at the flipped PNG row', () => {
    const src = sourceRgba();
    const raw = src.slice();
    maskRgbaInPlace(raw, N, bitsWith([[5, 10]]));
    expect(pixel(raw, 5, N - 1 - 10)).toEqual(pixel(src, 5, N - 1 - 10));
  });

  it('zeroes all four bytes (RGB and alpha) of every unexplored pixel', () => {
    const raw = sourceRgba();
    maskRgbaInPlace(raw, N, bitsWith([[5, 10]]));
    expect(pixel(raw, 5, 10)).toEqual([0, 0, 0, 0]);
    expect(pixel(raw, 0, 0)).toEqual([0, 0, 0, 0]);
    const nonZero = raw.reduce((count, b) => count + (b === 0 ? 0 : 1), 0);
    expect(nonZero).toBe(4);
  });

  it('keeps whole explored bytes via the fast path', () => {
    const src = sourceRgba();
    const raw = src.slice();
    const row = Array.from({ length: N }, (_, px): [number, number] => [px, 0]);
    maskRgbaInPlace(raw, N, bitsWith(row));
    const south = (N - 1) * N * 4;
    expect(Buffer.from(raw.subarray(south))).toEqual(
      Buffer.from(src.subarray(south)),
    );
    expect(pixel(raw, 3, 0)).toEqual([0, 0, 0, 0]);
  });

  it('rejects a raw buffer or bitset of the wrong size', () => {
    expect(() => maskRgbaInPlace(new Uint8Array(10), N, bitsWith([]))).toThrow(
      BaseMapMaskError,
    );
    expect(() => maskRgbaInPlace(sourceRgba(), N, new Uint8Array(3))).toThrow(
      BaseMapMaskError,
    );
  });
});

describe('inflateBitset / unionBitsets', () => {
  it('unions personal and shared layers', () => {
    const union = unionBitsets(
      [bitmapOf(bitsWith([[1, 1]])), bitmapOf(bitsWith([[2, 3]]))],
      N,
    );
    expect(Array.from(union)).toEqual(
      Array.from(
        bitsWith([
          [1, 1],
          [2, 3],
        ]),
      ),
    );
  });

  it('an empty list explores nothing', () => {
    expect(unionBitsets([], N).every((b) => b === 0)).toBe(true);
  });

  it('rejects a wrong-length, non-gzip or wrong-size bitmap', () => {
    const short = {
      width: N,
      height: N,
      data: gzipSync(Buffer.alloc(7)).toString('base64'),
    };
    expect(() => inflateBitset(short, N)).toThrow(/inflates to 7 B/);
    const notGzip = {
      width: N,
      height: N,
      data: Buffer.alloc(64).toString('base64'),
    };
    expect(() => inflateBitset(notGzip, N)).toThrow(/not a bounded gzip/);
    expect(() => inflateBitset(bitmapOf(bitsWith([])), 128)).toThrow(/≠ 128²/);
    const long = {
      width: N,
      height: N,
      data: gzipSync(Buffer.alloc(9999)).toString('base64'),
    };
    expect(() => inflateBitset(long, N)).toThrow(BaseMapMaskError);
  });
});

describe('maskFingerprint / maskEtag', () => {
  const base: MaskFingerprintInput = {
    baseSha: 'a'.repeat(64),
    textureSize: 2048,
    bitmaps: [
      { mapId: 1, layer: 'personal', capturedAtMs: 1000 },
      { mapId: 1, layer: 'shared', capturedAtMs: 1000 },
    ],
  };

  it('is equal for identical inputs in any order (two viewers, same exploration)', () => {
    const reordered = { ...base, bitmaps: [...base.bitmaps].reverse() };
    expect(maskFingerprint(reordered)).toBe(maskFingerprint(base));
  });

  it('changes when exploration, base map or size changes', () => {
    const fp = maskFingerprint(base);
    const later = {
      ...base,
      bitmaps: [
        base.bitmaps[0],
        { mapId: 1, layer: 'shared' as const, capturedAtMs: 2000 },
      ].filter((b): b is NonNullable<typeof b> => b !== undefined),
    };
    expect(maskFingerprint(later)).not.toBe(fp);
    expect(
      maskFingerprint({ ...base, bitmaps: base.bitmaps.slice(1) }),
    ).not.toBe(fp);
    expect(maskFingerprint({ ...base, baseSha: 'b'.repeat(64) })).not.toBe(fp);
    expect(maskFingerprint({ ...base, textureSize: 1024 })).not.toBe(fp);
  });

  it('formats as "m1-<40 hex>", never the old "<sha256>" ETag', () => {
    const fp = maskFingerprint(base);
    const etag = maskEtag(fp);
    expect(etag).toMatch(/^"m1-[0-9a-f]{40}"$/);
    expect(etag).not.toBe(`"${base.baseSha}"`);
    expect(etag).not.toBe(`"${fp}"`);
    expect(() => maskEtag('nope')).toThrow(BaseMapMaskError);
  });
});
