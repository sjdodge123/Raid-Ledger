import { valheimLinkBitmapBytes } from '@raid-ledger/contract';
import { gunzipSync, inflateRawSync } from 'node:zlib';

/** The bitmap fields the §6 server rule reads. */
export interface ValheimBitmapLike {
  width: number;
  height: number;
  data: string;
}

/** gzip header length when FLG = 0 (no FEXTRA/FNAME/FCOMMENT/FHCRC). */
const GZIP_PLAIN_HEADER = 10;
const GZIP_TRAILER = 8;

/** Input bytes a zlib engine consumed (`{ info: true }`); -1 when absent. */
function bytesConsumed(out: unknown): number {
  if (typeof out !== 'object' || out === null || !('engine' in out)) return -1;
  const { engine } = out;
  if (typeof engine !== 'object' || engine === null) return -1;
  if (!('bytesWritten' in engine)) return -1;
  return typeof engine.bytesWritten === 'number' ? engine.bytesWritten : -1;
}

/**
 * CONTRACT.md §6 server-enforced bitmap rule (lifted from
 * `valheim-link-contract.spec.ts`): bounded gunzip to exactly
 * `valheimLinkBitmapBytes(w, h)`, plain 10-byte header, and ONE gzip member
 * (a bounded raw inflate must consume every byte between header and trailer).
 */
export function valheimBitmapIsValid(bitmap: ValheimBitmapLike): boolean {
  const want = valheimLinkBitmapBytes(bitmap.width, bitmap.height);
  const gz = Buffer.from(bitmap.data, 'base64');
  try {
    const raw = gunzipSync(gz, { maxOutputLength: want });
    if (raw.length !== want || gz[3] !== 0) return false;
    const body = gz.subarray(GZIP_PLAIN_HEADER, gz.length - GZIP_TRAILER);
    const out: unknown = inflateRawSync(body, {
      maxOutputLength: want,
      info: true,
    });
    return bytesConsumed(out) === body.length;
  } catch {
    return false;
  }
}
