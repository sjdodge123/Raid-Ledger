/**
 * ROK-1949 — pure helpers for the per-viewer base-map mask. The server
 * never ships terrain outside the viewer's explored set: every unexplored
 * pixel becomes `0,0,0,0` (RGB zeroed, not just alpha — an alpha-0 pixel
 * still carries its colour). Bitset layout is CONTRACT §6: pixel (px, py)
 * = bit `py·n + px`, LSB first, `py = 0` is SOUTH; PNG row 0 is NORTH, so
 * PNG row `r` ↔ `py = n − 1 − r` (same flip as the web's `textureRowFor`).
 */
import { valheimLinkBitmapBytes } from '@raid-ledger/contract';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { ValheimBitmapLike } from '../../link/ingest/valheim-link-bitmap.helpers';

/** Bumped whenever the mask output for the same inputs changes. */
export const MASK_VERSION = 'rok1949-mask-v1';

/** One bitmap contributing to a viewer's explored set. */
export interface MaskBitmapRef {
  mapId: number;
  layer: 'personal' | 'shared';
  capturedAtMs: number;
}

/** Everything the masked bytes depend on — deliberately no viewer id. */
export interface MaskFingerprintInput {
  baseSha: string;
  textureSize: number;
  bitmaps: readonly MaskBitmapRef[];
}

/** Raised for every mask failure; callers fail closed (no bytes). */
export class BaseMapMaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaseMapMaskError';
  }
}

/** Bounded gunzip of one bitset; any other size / encoding throws. */
export function inflateBitset(
  bitmap: ValheimBitmapLike,
  n: number,
): Uint8Array {
  if (bitmap.width !== n || bitmap.height !== n) {
    throw new BaseMapMaskError(
      `bitmap ${bitmap.width}×${bitmap.height} ≠ ${n}²`,
    );
  }
  const want = valheimLinkBitmapBytes(n, n);
  let raw: Buffer;
  try {
    raw = gunzipSync(Buffer.from(bitmap.data, 'base64'), {
      maxOutputLength: want,
    });
  } catch {
    throw new BaseMapMaskError('bitmap is not a bounded gzip bitset');
  }
  if (raw.length !== want) {
    throw new BaseMapMaskError(
      `bitmap inflates to ${raw.length} B, want ${want}`,
    );
  }
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
}

/** OR of every bitset (none → nothing explored). */
export function unionBitsets(
  list: readonly ValheimBitmapLike[],
  n: number,
): Uint8Array {
  const out = new Uint8Array(valheimLinkBitmapBytes(n, n));
  for (const bitmap of list) {
    const bits = inflateBitset(bitmap, n);
    for (let i = 0; i < out.length; i += 1)
      out[i] = (out[i] ?? 0) | (bits[i] ?? 0);
  }
  return out;
}

/** Zeroes all four bytes of one pixel run `[px0, px1)` of PNG row `r`. */
function zeroRun(
  raw: Uint8Array,
  rowStart: number,
  px0: number,
  px1: number,
): void {
  raw.fill(0, rowStart + px0 * 4, rowStart + px1 * 4);
}

/** Masks one PNG row; whole-byte fast path when 8 bits agree. */
function maskRow(
  raw: Uint8Array,
  n: number,
  r: number,
  bits: Uint8Array,
): void {
  const rowStart = r * n * 4;
  const bitBase = (n - 1 - r) * n;
  let px = 0;
  while (px < n) {
    const i = bitBase + px;
    const byte = bits[i >> 3] ?? 0;
    if ((i & 7) === 0 && px + 8 <= n && (byte === 0 || byte === 0xff)) {
      if (byte === 0) zeroRun(raw, rowStart, px, px + 8);
      px += 8;
      continue;
    }
    if (((byte >> (i & 7)) & 1) === 0) zeroRun(raw, rowStart, px, px + 1);
    px += 1;
  }
}

/** Masks raw RGBA (`n²·4` bytes, row 0 = north) in place by `bits`. */
export function maskRgbaInPlace(
  raw: Uint8Array,
  n: number,
  bits: Uint8Array,
): void {
  if (raw.length !== n * n * 4) {
    throw new BaseMapMaskError(
      `raw RGBA is ${raw.length} B, want ${n * n * 4}`,
    );
  }
  if (bits.length !== valheimLinkBitmapBytes(n, n)) {
    throw new BaseMapMaskError(`bitset is ${bits.length} B for ${n}²`);
  }
  for (let r = 0; r < n; r += 1) maskRow(raw, n, r, bits);
}

/** sha256 (hex) of the mask inputs; order-independent over `bitmaps`. */
export function maskFingerprint(input: MaskFingerprintInput): string {
  const refs = [
    ...new Set(
      input.bitmaps.map((b) => `${b.mapId}:${b.layer}:${b.capturedAtMs}`),
    ),
  ].sort();
  return createHash('sha256')
    .update(
      [
        MASK_VERSION,
        input.baseSha,
        String(input.textureSize),
        refs.join(','),
      ].join('|'),
    )
    .digest('hex');
}

/** `"m1-<40 hex>"` — never equal to the pre-ROK-1949 `"<sha256>"` ETag. */
export function maskEtag(fingerprint: string): string {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new BaseMapMaskError('fingerprint must be 64 lowercase hex');
  }
  return `"m1-${fingerprint.slice(0, 40)}"`;
}
