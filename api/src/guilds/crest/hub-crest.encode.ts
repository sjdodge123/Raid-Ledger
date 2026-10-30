import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  GUILD_CREST_MAX_EDGE,
  GUILD_CREST_MIN_EDGE,
  type GuildCrestUploadErrorCode,
} from '@raid-ledger/contract';
import { sniffHubMediaImage } from '../../hub-media/hub-media.encode';

/** Stored square renditions: `lg` = the hero at 2x, `sm` = chips/cards at 2x. */
export const GUILD_CREST_LG_EDGE = 384;
export const GUILD_CREST_SM_EDGE = 128;
/** Same pixel-bomb guard as the hub-media pipeline (`hub-media.encode.ts`). */
const MAX_INPUT_PIXELS = 40_000_000;

/** The codes the encoder itself can produce (size/rate codes come from multer/redis). */
export type GuildCrestEncodeErrorCode = Extract<
  GuildCrestUploadErrorCode,
  'not_image' | 'too_small' | 'too_big_dimensions'
>;

export type GuildCrestEncodeResult =
  | { ok: true; key: string; sm: Buffer; lg: Buffer }
  | { ok: false; code: GuildCrestEncodeErrorCode };

/** sharp input: pixel bomb guard, first frame only, EXIF orientation applied. */
const load = (buf: Buffer): sharp.Sharp =>
  sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 }).rotate();

/** Centre-cropped square webp; sharp drops metadata (EXIF/GPS) by default. */
const square = (buf: Buffer, edge: number): Promise<Buffer> =>
  load(buf)
    .resize(edge, edge, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toBuffer();

/** `too_small` / `too_big_dimensions` from the header, or null when in range. */
async function checkEdges(
  buf: Buffer,
): Promise<GuildCrestEncodeErrorCode | null> {
  const { width, height } = await sharp(buf, {
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();
  if (!width || !height) return 'not_image';
  if (Math.min(width, height) < GUILD_CREST_MIN_EDGE) return 'too_small';
  if (Math.max(width, height) > GUILD_CREST_MAX_EDGE)
    return 'too_big_dimensions';
  return null;
}

/**
 * ROK-1814 — validate and re-encode crest bytes (an upload, or a gallery
 * picture copied into the public store). The type is sniffed from magic
 * bytes (png/jpeg/webp; gif, SVG and anything undecodable → `not_image`),
 * each edge must be 64–1024 px, and the output is a 384 + 128 px square
 * webp pair keyed by the first 32 hex chars of the `lg` file's sha256.
 */
export async function encodeGuildCrest(
  buf: Buffer,
): Promise<GuildCrestEncodeResult> {
  const type = sniffHubMediaImage(buf);
  if (!type || type === 'gif') return { ok: false, code: 'not_image' };
  try {
    const edgeError = await checkEdges(buf);
    if (edgeError) return { ok: false, code: edgeError };
    const lg = await square(buf, GUILD_CREST_LG_EDGE);
    const sm = await square(buf, GUILD_CREST_SM_EDGE);
    const key = createHash('sha256').update(lg).digest('hex').slice(0, 32);
    return { ok: true, key, sm, lg };
  } catch {
    return { ok: false, code: 'not_image' };
  }
}
