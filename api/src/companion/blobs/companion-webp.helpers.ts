/**
 * ROK-1956 — pure WebP container checks for companion blob uploads
 * (bg3-save CONTRACT §7: verify the header BEFORE any decode). Offsets are
 * the RIFF/WebP container spec, cross-checked in the spec against the
 * contract's placeholder fixture and sharp-generated lossy/lossless/alpha
 * files. Nothing here decodes pixels.
 *
 *   0 'RIFF' · 4 u32 LE riff size · 8 'WEBP' · 12 chunk FourCC · 16 u32 size
 *   VP8  : 23 start code 9d 01 2a · 26/28 u16 LE, low 14 bits = width/height
 *   VP8L : 20 signature 0x2f · 21 u32 LE: width−1 (14) height−1 (14) α (1) version (3)
 *   VP8X : 20 flags (0x02 = animation) · 24/27 u24 LE width−1 / height−1
 */

/** Bytes the header check needs (the VP8X layout is the longest). */
export const WEBP_HEADER_BYTES = 30;

const RIFF = Buffer.from('RIFF', 'latin1');
const WEBP = Buffer.from('WEBP', 'latin1');
const VP8_START_CODE = Buffer.from([0x9d, 0x01, 0x2a]);
const VP8L_SIGNATURE = 0x2f;
const VP8X_ANIMATION_FLAG = 0x02;
const MASK_14 = 0x3fff;

/** A still-image WebP chunk type the server accepts. */
export type WebpFormat = 'VP8 ' | 'VP8L' | 'VP8X';

/** Why a header was refused (logged, never sent — the wire code is `invalid_blob`). */
export type WebpHeaderRefusal =
  | 'truncated'
  | 'not_riff_webp'
  | 'unknown_chunk'
  | 'bad_vp8_start_code'
  | 'bad_vp8l_signature'
  | 'animated'
  | 'edge_out_of_range';

/** Parsed header; `riffSize` is the u32 at offset 4 (file length − 8). */
export interface WebpHeader {
  ok: true;
  format: WebpFormat;
  width: number;
  height: number;
  riffSize: number;
}

/** Outcome of {@link parseWebpHeader}. */
export type WebpHeaderResult =
  WebpHeader | { ok: false; reason: WebpHeaderRefusal };

type Dims = { width: number; height: number } | WebpHeaderRefusal;

/** True while the bytes seen so far could still start `RIFF????WEBP`. */
export function webpSignatureSoFarOk(head: Buffer): boolean {
  const riffPart = head.subarray(0, 4);
  if (!riffPart.equals(RIFF.subarray(0, riffPart.length))) return false;
  const webpPart = head.subarray(8, 12);
  return webpPart.equals(WEBP.subarray(0, webpPart.length));
}

/** RIFF size field + 8 must equal the streamed byte length (checked at EOF). */
export function riffLengthMatches(
  riffSize: number,
  totalBytes: number,
): boolean {
  return riffSize + 8 === totalBytes;
}

/**
 * Parse the first {@link WEBP_HEADER_BYTES} of a still WebP: magic, chunk
 * type, codec signature and dimensions within 1…`maxEdge`. Animated VP8X and
 * any other chunk type are refused.
 */
export function parseWebpHeader(
  head: Buffer,
  maxEdge: number,
): WebpHeaderResult {
  if (head.length < WEBP_HEADER_BYTES) return refuse('truncated');
  if (!head.subarray(0, 4).equals(RIFF) || !head.subarray(8, 12).equals(WEBP)) {
    return refuse('not_riff_webp');
  }
  const format = head.toString('latin1', 12, 16);
  if (!isWebpFormat(format)) return refuse('unknown_chunk');
  const dims = dimsOf(format, head);
  if (typeof dims === 'string') return refuse(dims);
  if (!inRange(dims.width, maxEdge) || !inRange(dims.height, maxEdge)) {
    return refuse('edge_out_of_range');
  }
  return {
    ok: true,
    format: format,
    ...dims,
    riffSize: head.readUInt32LE(4),
  };
}

function isWebpFormat(fourCc: string): fourCc is WebpFormat {
  return fourCc === 'VP8 ' || fourCc === 'VP8L' || fourCc === 'VP8X';
}

function dimsOf(format: WebpFormat, head: Buffer): Dims {
  if (format === 'VP8 ') return vp8Dims(head);
  if (format === 'VP8L') return vp8lDims(head);
  return vp8xDims(head);
}

function vp8Dims(head: Buffer): Dims {
  if (!head.subarray(23, 26).equals(VP8_START_CODE))
    return 'bad_vp8_start_code';
  return {
    width: head.readUInt16LE(26) & MASK_14,
    height: head.readUInt16LE(28) & MASK_14,
  };
}

function vp8lDims(head: Buffer): Dims {
  if (head[20] !== VP8L_SIGNATURE) return 'bad_vp8l_signature';
  const bits = head.readUInt32LE(21);
  if (bits >>> 29 !== 0) return 'bad_vp8l_signature';
  return {
    width: (bits & MASK_14) + 1,
    height: ((bits >>> 14) & MASK_14) + 1,
  };
}

function vp8xDims(head: Buffer): Dims {
  if (((head[20] ?? 0) & VP8X_ANIMATION_FLAG) !== 0) return 'animated';
  return {
    width: head.readUIntLE(24, 3) + 1,
    height: head.readUIntLE(27, 3) + 1,
  };
}

function inRange(edge: number, maxEdge: number): boolean {
  return Number.isInteger(edge) && edge >= 1 && edge <= maxEdge;
}

function refuse(reason: WebpHeaderRefusal): {
  ok: false;
  reason: WebpHeaderRefusal;
} {
  return { ok: false, reason };
}
