/**
 * ROK-1814 Q5 — bring a crest pick within 1 MiB and 1024 px in the browser
 * before upload (the server refuses bigger ones). Reuses the gallery's JPEG
 * re-encoder; anything the browser cannot decode goes up as-is and the server
 * answers with a coded error.
 */
import { GUILD_CREST_MAX_EDGE, GUILD_CREST_UPLOAD_MAX_BYTES } from '@raid-ledger/contract';
import { encodeJpeg, SHRINK_QUALITIES, type JpegEncoder } from '../../../lib/hub-media-shrink';

export interface ImageSize { width: number; height: number }

export interface CrestShrinkDeps {
    measure: (file: File) => Promise<ImageSize | null>;
    encode: JpegEncoder;
}

async function measureImage(file: File): Promise<ImageSize | null> {
    if (typeof createImageBitmap !== 'function') return null;
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}

const DEFAULT_DEPS: CrestShrinkDeps = { measure: measureImage, encode: encodeJpeg };

/** Returns `file` untouched when it already fits, else a JPEG within the limits (or `file` if that fails). */
export async function shrinkCrestForUpload(file: File, deps: CrestShrinkDeps = DEFAULT_DEPS): Promise<File> {
    const size = await deps.measure(file).catch(() => null);
    if (size === null) return file;
    const tooWide = Math.max(size.width, size.height) > GUILD_CREST_MAX_EDGE;
    if (!tooWide && file.size <= GUILD_CREST_UPLOAD_MAX_BYTES) return file;
    for (const quality of SHRINK_QUALITIES) {
        const blob = await deps.encode(file, GUILD_CREST_MAX_EDGE, quality).catch(() => null);
        if (blob === null) return file;
        if (blob.size <= GUILD_CREST_UPLOAD_MAX_BYTES) {
            return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'crest'}.jpg`, { type: 'image/jpeg' });
        }
    }
    return file;
}
