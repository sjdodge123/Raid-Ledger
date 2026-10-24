import sharp from 'sharp';

export type HubMediaImageType = 'png' | 'jpeg' | 'webp' | 'gif';

/** Longest side of the stored full picture; thumbs are a square crop. */
export const HUB_MEDIA_FULL_EDGE = 2048;
export const HUB_MEDIA_THUMB_EDGE = 480;
const MAX_INPUT_PIXELS = 40_000_000;

const startsWith = (buf: Buffer, magic: readonly number[], at = 0): boolean =>
  buf.length >= at + magic.length && magic.every((b, i) => buf[at + i] === b);

/** Identify the image by its magic bytes — a declared type is never trusted. */
export function sniffHubMediaImage(buf: Buffer): HubMediaImageType | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  const riff = startsWith(buf, [0x52, 0x49, 0x46, 0x46]);
  if (riff && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

export interface EncodedHubMedia {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/** sharp input: pixel bomb guard, first GIF frame only, EXIF orientation applied. */
const load = (buf: Buffer) =>
  sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 }).rotate();

/**
 * Re-encode an uploaded picture (spec D4): full = longest side ≤ 2048, webp
 * q80, aspect kept; thumb = 480² cover crop, webp q70. sharp drops metadata
 * by default. `null` when the bytes are not a supported, decodable image.
 */
export async function encodeHubMedia(
  buf: Buffer,
): Promise<EncodedHubMedia | null> {
  if (!sniffHubMediaImage(buf)) return null;
  try {
    const full = await load(buf)
      .resize(HUB_MEDIA_FULL_EDGE, HUB_MEDIA_FULL_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await load(buf)
      .resize(HUB_MEDIA_THUMB_EDGE, HUB_MEDIA_THUMB_EDGE, { fit: 'cover' })
      .webp({ quality: 70 })
      .toBuffer();
    return {
      full: full.data,
      thumb,
      width: full.info.width,
      height: full.info.height,
    };
  } catch {
    return null;
  }
}
