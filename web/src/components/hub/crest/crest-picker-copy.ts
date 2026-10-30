/**
 * ROK-1814 — the picker's words: coded upload errors → friendly copy, the
 * staff-removal notice (Q7) and the emblem / palette option names.
 */
import { GuildCrestUploadErrorCodeSchema, type GuildCrestUploadErrorCode } from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf } from '../../../lib/api/api-error';

export const CREST_UPLOAD_ERROR_COPY: Record<GuildCrestUploadErrorCode, string> = {
    not_image: "Only PNG, JPEG or WebP images can be used. SVG files aren't allowed.",
    too_large: 'That image is over 1 MB even after shrinking. Try a smaller one.',
    too_small: 'That image is too small. Use one at least 64 × 64 px.',
    too_big_dimensions: 'That image is bigger than 1024 px. Try a smaller one.',
    rate_limited: 'Too many crest changes this hour. Try again later.',
};

export const CREST_UPLOAD_HELP =
    'PNG, JPEG or WebP, up to 1 MB, 64–1024 px. Non-square images are cropped to the centre; big photos are shrunk before upload.';

/** A coded server error → its copy; a gallery 404 → "gone"; anything else → a generic retry line. */
export function crestErrorMessage(err: unknown): string {
    const code = GuildCrestUploadErrorCodeSchema.safeParse(errorBodyOf(err)?.['code']);
    if (code.success) return CREST_UPLOAD_ERROR_COPY[code.data];
    if (httpStatusOf(err) === 404) return 'That picture is no longer in the gallery.';
    return "Couldn't save the crest. Try again.";
}

/** Q7 — "Removed by an admin on 29 Oct 2026". */
export function removedNotice(iso: string): string {
    const date = new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return `Removed by an admin on ${date}`;
}

/** `wolf-head` → `Wolf head`; `or` → `Or`. */
export function optionName(id: string): string {
    const words = id.replace(/-/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}
