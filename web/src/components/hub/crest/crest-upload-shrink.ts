/**
 * ROK-1814 Q5 — bring a crest pick within 1 MiB and 1024 px in the browser
 * before upload (the server refuses bigger ones). An opaque JPEG is
 * re-encoded as JPEG; a PNG / WebP (which may be transparent) as WebP, so the
 * transparency survives — the server accepts WebP and stores WebP anyway. A
 * browser without a WebP encoder hands back PNG; if no transparent encoding
 * fits, JPEG is the last resort. Anything the browser cannot decode goes up
 * as-is and the server answers with a coded error.
 */
import { GUILD_CREST_MAX_EDGE, GUILD_CREST_UPLOAD_MAX_BYTES } from '@raid-ledger/contract';
import { encodeImage, mayHaveAlpha, SHRINK_QUALITIES, type ImageEncoder, type ShrinkOutputType } from '../../../lib/hub-media-shrink';

export interface ImageSize { width: number; height: number }

export interface CrestShrinkDeps {
    measure: (file: File) => Promise<ImageSize | null>;
    encode: ImageEncoder;
}

async function measureImage(file: File): Promise<ImageSize | null> {
    if (typeof createImageBitmap !== 'function') return null;
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}

const DEFAULT_DEPS: CrestShrinkDeps = { measure: measureImage, encode: encodeImage };

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

function renamed(file: File, blob: Blob, type: ShrinkOutputType): File {
    const actual = EXTENSIONS[blob.type] === undefined ? type : blob.type;
    const base = file.name.replace(/\.[^.]*$/, '') || 'crest';
    return new File([blob], `${base}.${EXTENSIONS[actual] ?? 'jpg'}`, { type: actual });
}

/** Tries each quality as `type`; the first blob within the byte cap, else null (`undefined` = undecodable). */
async function encodeWithin(file: File, type: ShrinkOutputType, encode: ImageEncoder): Promise<File | null | undefined> {
    for (const quality of SHRINK_QUALITIES) {
        const blob = await encode(file, GUILD_CREST_MAX_EDGE, quality, type).catch(() => null);
        if (blob === null) return undefined;
        if (blob.size <= GUILD_CREST_UPLOAD_MAX_BYTES) return renamed(file, blob, type);
    }
    return null;
}

/** Returns `file` untouched when it already fits, else a re-encode within the limits (or `file` if that fails). */
export async function shrinkCrestForUpload(file: File, deps: CrestShrinkDeps = DEFAULT_DEPS): Promise<File> {
    const size = await deps.measure(file).catch(() => null);
    if (size === null) return file;
    const tooWide = Math.max(size.width, size.height) > GUILD_CREST_MAX_EDGE;
    if (!tooWide && file.size <= GUILD_CREST_UPLOAD_MAX_BYTES) return file;
    const types: ShrinkOutputType[] = mayHaveAlpha(file) ? ['image/webp', 'image/jpeg'] : ['image/jpeg'];
    for (const type of types) {
        const out = await encodeWithin(file, type, deps.encode);
        if (out === undefined) return file;
        if (out !== null) return out;
    }
    return file;
}
