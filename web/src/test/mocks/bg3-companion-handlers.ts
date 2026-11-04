/**
 * ROK-1960 — MSW builders for the two Companion routes the browser BG3 save
 * upload uses. Not in the default handler list: an upload spec
 * `server.use()`s them. Spies get the raw request so specs can assert order,
 * headers and bodies.
 */
import { http, HttpResponse } from 'msw';
import type { CompanionBlobAck, CompanionIngestAck, CompanionIngestErrorCode } from '@raid-ledger/contract';

export const COMPANION_URL = 'http://localhost:3000/companion/v1';
export const COMPANION_BLOB_URL = `${COMPANION_URL}/blobs/:sha256`;
export const COMPANION_BG3_MESSAGE_URL = `${COMPANION_URL}/messages/bg3-save`;

/** A refusal in the ingest error shape (`CompanionIngestErrorSchema`). */
export interface CompanionRefusal {
    readonly status: number;
    readonly code: CompanionIngestErrorCode;
}

export interface CompanionBlobCall {
    readonly sha256: string;
    readonly contentType: string | null;
    readonly bytes: Uint8Array;
}

export function companionError({ status, code }: CompanionRefusal) {
    return HttpResponse.json({ code, message: code }, { status });
}

/** `PUT /blobs/:sha256` → `stored` (201) / `exists` (200), or a refusal. */
export function companionBlobHandler(
    reply: CompanionBlobAck['status'] | CompanionRefusal = 'stored',
    spy?: (call: CompanionBlobCall) => void,
) {
    return http.put(COMPANION_BLOB_URL, async ({ request, params }) => {
        const sha256 = String(params['sha256']);
        spy?.({ sha256, contentType: request.headers.get('content-type'), bytes: new Uint8Array(await request.arrayBuffer()) });
        if (typeof reply !== 'string') return companionError(reply);
        return HttpResponse.json({ status: reply, sha256 }, { status: reply === 'stored' ? 201 : 200 });
    });
}

/** `POST /messages/bg3-save` → 202 `accepted` / `stale`, or a refusal. */
export function companionBg3MessageHandler(
    reply: CompanionIngestAck['status'] | CompanionRefusal = 'accepted',
    spy?: (body: unknown) => void,
) {
    return http.post(COMPANION_BG3_MESSAGE_URL, async ({ request }) => {
        spy?.(JSON.parse(await request.text()) as unknown);
        if (typeof reply !== 'string') return companionError(reply);
        return HttpResponse.json({ status: reply }, { status: 202 });
    });
}
