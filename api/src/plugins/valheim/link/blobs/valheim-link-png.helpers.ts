import { BadRequestException } from '@nestjs/common';
import { ingestError } from '../valheim-link-request';

/** The 8-byte PNG signature. */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Signature (8) + IHDR length (4) + type (4) + data (13) + CRC (4). */
export const PNG_HEADER_BYTES = 33;

/** Decode-cost edge cap for any blob (spec Q10 default). */
export const VALHEIM_BLOB_EDGE_MAX = 16_384;

/** Width/height read from IHDR — no pixel is decoded. */
export interface PngDimensions {
  width: number;
  height: number;
}

const bad = (code: 'not_png' | 'bad_ihdr' | 'png_too_large', m: string) =>
  new BadRequestException(ingestError(code, m));

/** True while `head`'s bytes so far agree with the PNG signature. */
export function signatureSoFarOk(head: Buffer): boolean {
  const n = Math.min(head.length, PNG_SIGNATURE.length);
  return head.subarray(0, n).equals(PNG_SIGNATURE.subarray(0, n));
}

/**
 * Validate the first {@link PNG_HEADER_BYTES} of a PNG (CONTRACT §1): the
 * signature (400 `not_png`), a first chunk `IHDR` of length 13 (400
 * `bad_ihdr`, also for a truncated header), and 1 ≤ edge ≤ `maxEdge`
 * (400 `png_too_large`). Never decodes pixels.
 */
export function parsePngHeader(head: Buffer, maxEdge: number): PngDimensions {
  if (head.length === 0 || !signatureSoFarOk(head)) {
    throw bad('not_png', 'body is not a PNG');
  }
  if (head.length < PNG_HEADER_BYTES) {
    throw bad('bad_ihdr', 'PNG header is truncated');
  }
  const length = head.readUInt32BE(8);
  const type = head.toString('latin1', 12, 16);
  if (length !== 13 || type !== 'IHDR') {
    throw bad('bad_ihdr', 'first PNG chunk is not IHDR');
  }
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  const fits = (edge: number): boolean => edge >= 1 && edge <= maxEdge;
  if (!fits(width) || !fits(height)) {
    throw bad('png_too_large', `PNG edge must be 1..${maxEdge}`);
  }
  return { width, height };
}

/**
 * Test/fixture helper: a signature + IHDR header (33 bytes, CRC zeroed —
 * the route never checks it) declaring `width`×`height`.
 */
export function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(PNG_HEADER_BYTES);
  PNG_SIGNATURE.copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf.writeUInt8(8, 24); // bit depth
  buf.writeUInt8(6, 25); // colour type RGBA
  return buf;
}
