/**
 * ROK-1949 — decode the stored base map, mask every unexplored pixel to
 * `0,0,0,0`, re-encode. Fails CLOSED: every error surfaces as a
 * `BaseMapMaskError` and no code path returns the source bytes.
 */
import sharp from 'sharp';
import { BaseMapMaskError, maskRgbaInPlace } from './valheim-map-mask.helpers';

async function decodeRgba(source: string | Buffer, n: number): Promise<Buffer> {
  const { data, info } = await sharp(source, { limitInputPixels: n * n })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== n || info.height !== n || info.channels !== 4) {
    throw new BaseMapMaskError(
      `base map is ${info.width}×${info.height}×${info.channels}, want ${n}²×4`,
    );
  }
  return data;
}

/**
 * Masked PNG for `source` (absolute path or bytes) of edge `n` under the
 * explored bitset `bits`. Metadata is stripped (no `withMetadata`).
 */
export async function renderMaskedBaseMap(
  source: string | Buffer,
  n: number,
  bits: Uint8Array,
): Promise<Buffer> {
  try {
    const raw = await decodeRgba(source, n);
    maskRgbaInPlace(raw, n, bits);
    return await sharp(raw, { raw: { width: n, height: n, channels: 4 } })
      .png({ compressionLevel: 6, adaptiveFiltering: false })
      .toBuffer();
  } catch (err) {
    if (err instanceof BaseMapMaskError) throw err;
    throw new BaseMapMaskError('base map could not be masked');
  }
}
