/**
 * ROK-1965 — `POST /hubs/:guildId/media` (multipart, field `file`). XHR for
 * upload progress, through the constructor `native-fetch.ts` captured, with
 * one silent token refresh on 401 like `avatar-api.ts`. 201 = a new picture,
 * 200 = the same bytes were already live (the existing item comes back).
 * Schema-bound — loaded on demand by `use-hub-gallery-upload.ts`.
 */
import { HubMediaItemSchema, HubMediaUploadErrorCodeSchema, type HubMediaItem } from '@raid-ledger/contract';
import { getAuthToken } from '../hooks/use-auth';
import { NativeXHR, nativeXhr } from './api/native-fetch';
import { encodePathSegment } from './api/path-segment';
import { ensureFreshToken } from './api/refresh-client';
import { getAuthMethod } from './api/silent-reauth';
import { API_BASE_URL } from './config';
import { HubMediaUploadError } from './hub-media-upload-copy';

export interface HubMediaUploadResult {
    item: HubMediaItem;
    /** True on 200: the picture was already in the gallery. */
    duplicate: boolean;
}

export async function uploadHubMedia(
    guildId: number, file: File, onProgress: (percent: number) => void = () => undefined,
): Promise<HubMediaUploadResult> {
    const path = `/hubs/${encodePathSegment(String(guildId))}/media`;
    const form = new FormData();
    form.append('file', file, file.name);
    // A refresh retry restarts XHR progress at 0: keep the reported value monotonic.
    let ceiling = 0;
    const report = (percent: number): void => { ceiling = Math.max(ceiling, percent); onProgress(ceiling); };
    try {
        return await send(path, form, report);
    } catch (err) {
        if (err instanceof HubMediaUploadError && err.status === 401 && getAuthMethod() && await ensureFreshToken()) {
            return send(path, form, report);
        }
        throw err;
    }
}

function send(path: string, form: FormData, onProgress: (percent: number) => void): Promise<HubMediaUploadResult> {
    return new Promise((resolve, reject) => {
        const xhr = new NativeXHR();
        nativeXhr.open(xhr, 'POST', `${API_BASE_URL}${path}`);
        const token = getAuthToken();
        if (token) nativeXhr.setRequestHeader(xhr, 'Authorization', `Bearer ${token}`);
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => {
            try { resolve(settle(xhr.status, xhr.responseText)); } catch (err) { reject(err); }
        });
        xhr.addEventListener('error', () => reject(new HubMediaUploadError(0, null, 'Upload failed')));
        nativeXhr.send(xhr, form);
    });
}

function parseJson(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
}

/** 2xx → the parsed item; otherwise throws a `HubMediaUploadError` carrying the body's `code`. */
export function settle(status: number, text: string): HubMediaUploadResult {
    const body = parseJson(text);
    if (status >= 200 && status < 300) {
        const parsed = HubMediaItemSchema.safeParse(body);
        if (!parsed.success) throw new HubMediaUploadError(status, null, 'Unexpected upload response');
        return { item: parsed.data, duplicate: status === 200 };
    }
    const fields: object = typeof body === 'object' && body !== null ? body : {};
    const code = 'code' in fields ? HubMediaUploadErrorCodeSchema.safeParse(fields.code) : null;
    const message = 'message' in fields && typeof fields.message === 'string' ? fields.message : `HTTP ${status}`;
    throw new HubMediaUploadError(status, code?.success ? code.data : null, message);
}
