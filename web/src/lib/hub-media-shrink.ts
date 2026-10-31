/**
 * ROK-1965 ruling 5 — a pick over `HUB_MEDIA_UPLOAD_MAX_BYTES` (9 MiB; nginx
 * caps bodies at 10m) is re-encoded in the browser before upload: decode with
 * `createImageBitmap`, draw onto a canvas no longer than 4096px on its long
 * edge, export JPEG at q0.92 (once more at q0.8 if that is still too big).
 * Anything the browser cannot decode goes up as-is and the server answers 415.
 */
import { HUB_MEDIA_UPLOAD_MAX_BYTES } from '@raid-ledger/contract';

export const SHRINK_MAX_EDGE = 4096;
export const SHRINK_QUALITIES = [0.92, 0.8] as const;

/** Re-encodes `file` as JPEG within `maxEdge`; null when the browser can't decode it. */
export type JpegEncoder = (file: File, maxEdge: number, quality: number) => Promise<Blob | null>;

export async function shrinkForUpload(file: File, encode: JpegEncoder = encodeJpeg): Promise<File> {
    if (file.size <= HUB_MEDIA_UPLOAD_MAX_BYTES) return file;
    for (const quality of SHRINK_QUALITIES) {
        const blob = await encode(file, SHRINK_MAX_EDGE, quality).catch(() => null);
        if (blob === null) return file;
        if (blob.size <= HUB_MEDIA_UPLOAD_MAX_BYTES) return new File([blob], jpegName(file.name), { type: 'image/jpeg' });
    }
    return file;
}

function jpegName(name: string): string {
    const base = name.replace(/\.[^.]*$/, '');
    return `${base === '' ? 'picture' : base}.jpg`;
}

/** The output types the shrinkers ask the canvas for. */
export type ShrinkOutputType = 'image/jpeg' | 'image/webp';

/** Re-encodes `file` as `type` within `maxEdge`; null when the browser can't decode it. */
export type ImageEncoder = (file: File, maxEdge: number, quality: number, type: ShrinkOutputType) => Promise<Blob | null>;

/** PNG and WebP can carry transparency; re-encoding them as JPEG would turn it black. */
export function mayHaveAlpha(file: File): boolean {
    return file.type === 'image/png' || file.type === 'image/webp';
}

/** Decodes `file` and re-encodes it as JPEG no longer than `maxEdge`; null when it cannot. */
export function encodeJpeg(file: File, maxEdge: number, quality: number): Promise<Blob | null> {
    return encodeImage(file, maxEdge, quality, 'image/jpeg');
}

/**
 * Decodes `file` and re-encodes it as `type` no longer than `maxEdge`; null when it cannot.
 * A browser without a WebP encoder hands back PNG, so callers name the file from `blob.type`.
 */
export async function encodeImage(file: File, maxEdge: number, quality: number, type: ShrinkOutputType): Promise<Blob | null> {
    if (typeof createImageBitmap !== 'function') return null;
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx === null) return null;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    } finally {
        bitmap.close();
    }
}
