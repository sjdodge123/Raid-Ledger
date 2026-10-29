/**
 * ROK-1965 — the Gallery upload's light half: the error type, the picker's
 * `accept` list and the plain copy for every outcome (spec §6). Type-only
 * contract imports, so the eager card header can carry it; the schema-bound
 * XHR client (`hub-media-upload-api.ts`) and the shrink step load on demand.
 */
import type { HubMediaUploadErrorCode } from '@raid-ledger/contract';

/** Mirrors `HUB_MEDIA_UPLOAD_TYPES` (a spec pins the two together). */
export const HUB_MEDIA_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp';

export const HUB_MEDIA_UPLOAD_SUCCESS = 'Picture added';
export const HUB_MEDIA_UPLOAD_DUPLICATE = 'That picture is already in the gallery.';
export const HUB_MEDIA_UPLOAD_FALLBACK = "Couldn't add the picture — try again.";

/** A failed upload: the HTTP status (0 = network) and the body's `code`, when it named one. */
export class HubMediaUploadError extends Error {
    readonly status: number;
    readonly code: HubMediaUploadErrorCode | null;
    constructor(status: number, code: HubMediaUploadErrorCode | null, message: string) {
        super(message);
        this.name = 'HubMediaUploadError';
        this.status = status;
        this.code = code;
    }
}

export const HUB_MEDIA_UPLOAD_ERROR_COPY: Record<HubMediaUploadErrorCode, string> = {
    too_large: 'That picture is too big (max 9 MB).',
    not_image: 'Only PNG, JPEG or WebP pictures can be added.',
    removed: 'That picture was removed from this hub.',
    cap: "This hub's gallery is full. Ask the hub leader to remove some pictures.",
    rate_limited: "You've added a lot of pictures — try again later.",
    busy: 'The gallery is busy — try again in a moment.',
};

/** Copy for a status with no `code` (nginx's own 413 carries none). */
const STATUS_COPY: Partial<Record<number, string>> = {
    400: 'Choose a picture to upload.',
    413: HUB_MEDIA_UPLOAD_ERROR_COPY.too_large,
};

/** The plain sentence a member sees for a failed upload. */
export function hubMediaUploadErrorCopy(err: unknown): string {
    if (!(err instanceof HubMediaUploadError)) return HUB_MEDIA_UPLOAD_FALLBACK;
    if (err.code !== null) return HUB_MEDIA_UPLOAD_ERROR_COPY[err.code];
    return STATUS_COPY[err.status] ?? HUB_MEDIA_UPLOAD_FALLBACK;
}
