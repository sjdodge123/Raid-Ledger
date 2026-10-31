/**
 * ROK-1960 L2 — error codes for the browser save upload (spec section 7,
 * server rows). Every failure the upload hook raises is a `Bg3UploadError`,
 * so the sheet (L3) branches on `code` and never on an HTTP status.
 */
import { Bg3CrossHubMoveSchema, type Bg3CrossHubMove } from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf } from '../../../lib/api/api-error';

export type Bg3UploadErrorCode =
    | 'invalid_payload'
    | 'session_expired'
    | 'uploads_disabled'
    | 'server_refused'
    | 'rate_limited'
    | 'bind_failed'
    | 'cross_hub_move'
    | 'upload_failed';

export class Bg3UploadError extends Error {
    readonly code: Bg3UploadErrorCode;
    /** The server's error `code` (413/422) or the first schema issue path (`invalid_payload`). */
    readonly detail: string | null;
    /** `cross_hub_move`: the server's 409 body — where the saves sit; nothing moved. */
    readonly move: Bg3CrossHubMove | null;
    constructor(code: Bg3UploadErrorCode, detail: string | null = null, move: Bg3CrossHubMove | null = null) {
        super(code);
        Object.setPrototypeOf(this, Bg3UploadError.prototype);
        this.name = 'Bg3UploadError';
        this.code = code;
        this.detail = detail;
        this.move = move;
    }
}

function serverCodeOf(error: unknown): string | null {
    const code = errorBodyOf(error)?.['code'];
    return typeof code === 'string' ? code : null;
}

/** The bind's 409 `cross_hub_move` body, else `null`. */
export function crossHubMoveOf(error: unknown): Bg3CrossHubMove | null {
    if (httpStatusOf(error) !== 409) return null;
    const parsed = Bg3CrossHubMoveSchema.safeParse(errorBodyOf(error));
    return parsed.success ? parsed.data : null;
}

/** Map a thrown `fetchApi` error (or anything else) onto a section-7 code. */
export function toBg3UploadError(error: unknown): Bg3UploadError {
    if (error instanceof Bg3UploadError) return error;
    const status = httpStatusOf(error);
    const serverCode = serverCodeOf(error);
    if (status === 401) return new Bg3UploadError('session_expired');
    if (status === 404 && serverCode === 'unknown_contract') return new Bg3UploadError('uploads_disabled');
    if (status === 429) return new Bg3UploadError('rate_limited');
    if (status === 400 || status === 413 || status === 422) {
        return new Bg3UploadError('server_refused', serverCode ?? String(status));
    }
    return new Bg3UploadError('upload_failed');
}

/** Inline-banner copy for each code (spec section 7). */
export function bg3UploadErrorMessage(error: Bg3UploadError): string {
    switch (error.code) {
        case 'invalid_payload':
            return error.detail ? `This save can't be read (${error.detail}).` : "This save can't be read.";
        case 'session_expired':
            return 'Your session expired. Sign in again.';
        case 'uploads_disabled':
            return 'BG3 uploads are turned off on this site.';
        case 'server_refused':
            return `The server refused this save (${error.detail ?? 'unknown'}).`;
        case 'rate_limited':
            return 'Too many uploads. Try again in a minute.';
        case 'bind_failed':
            // D-6: the bind runs before the message, so a failed bind means nothing was posted.
            return "Couldn't file the save under that campaign, so it wasn't uploaded. Try again.";
        case 'cross_hub_move':
            return 'This playthrough is filed in another hub. Pick Move here to move it.';
        case 'upload_failed':
            return "Couldn't upload the save. Try again.";
    }
}
