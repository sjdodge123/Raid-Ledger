/**
 * ROK-1960 L2 — upload client for a save parsed in the browser (spec D-1,
 * D-6, D-7). It reuses the Companion ingest routes on the session JWT
 * (`fetchApi` sends `Bearer <jwt>`, which the ingest guard accepts for
 * `bg3-save`); the raw `.lsv` never leaves the browser (CONTRACT §4).
 * The campaign-key bind reuses `bindBg3CampaignKey` (`../api/bg3-api`).
 */
import {
    BG3_SAVE_CONTRACT_ID,
    BG3_SAVE_CONTRACT_VERSION,
    COMPANION_ENVELOPE_VERSION,
    Bg3SaveMessageSchema,
    CompanionBlobAckSchema,
    CompanionIngestAckSchema,
    CompanionVersionStringSchema,
    type Bg3SaveMessage,
    type Bg3SavePayload,
    type CompanionBlobAck,
    type CompanionIngestAck,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { Bg3UploadError } from './bg3-upload-errors';

export const COMPANION_API = '/companion/v1';
/** `appVersion` when the build defines no usable `__APP_VERSION__` (D-7). */
export const BG3_WEB_APP_VERSION_FALLBACK = '0.0.0-web';

/**
 * What the L1 parse layer hands over: the normalised payload, the WebP bytes
 * behind `payload.thumbnail` (`null` exactly when it is `null`), and the
 * vendored rl-collectors crate version from `PROVENANCE.json` (D-7).
 */
export interface Bg3ParsedSave {
    readonly payload: Bg3SavePayload;
    readonly webp: Uint8Array<ArrayBuffer> | null;
    readonly collectorVersion: string;
}

/** The web build's semver (root `package.json`), else the fallback. */
export function webAppVersion(): string {
    const raw: unknown = typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__;
    const ok = typeof raw === 'string' && CompanionVersionStringSchema.safeParse(raw).success;
    return ok ? raw : BG3_WEB_APP_VERSION_FALLBACK;
}

/** `savedAt` (file mtime) never after `capturedAt`: a future mtime is clamped to it. */
function clampSavedAt(savedAt: string, capturedAt: string, now: number): string {
    return Date.parse(savedAt) > now ? capturedAt : savedAt;
}

/**
 * The full `bg3-save` v1 message, validated with the contract schema before
 * anything is sent. Throws `Bg3UploadError('invalid_payload', <issue path>)`.
 */
export function buildBg3SaveMessage(save: Bg3ParsedSave, now: number = Date.now()): Bg3SaveMessage {
    const capturedAt = new Date(now).toISOString();
    const result = Bg3SaveMessageSchema.safeParse({
        envelopeVersion: COMPANION_ENVELOPE_VERSION,
        contract: BG3_SAVE_CONTRACT_ID,
        contractVersion: BG3_SAVE_CONTRACT_VERSION,
        capturedAt,
        appVersion: webAppVersion(),
        collectorVersion: save.collectorVersion,
        payload: { ...save.payload, savedAt: clampSavedAt(save.payload.savedAt, capturedAt, now) },
    });
    if (result.success) return result.data;
    const first = result.error.issues[0];
    throw new Bg3UploadError('invalid_payload', first ? first.path.join('.') || first.code : null);
}

/** `PUT /companion/v1/blobs/:sha256` — raw WebP bytes (201 `stored` / 200 `exists`). */
export function putBg3Thumbnail(sha256: string, webp: Uint8Array<ArrayBuffer>): Promise<CompanionBlobAck> {
    const init: RequestInit = { method: 'PUT', body: webp, headers: { 'Content-Type': 'image/webp' } };
    return fetchApi(`${COMPANION_API}/blobs/${encodePathSegment(sha256)}`, init, CompanionBlobAckSchema);
}

/** `POST /companion/v1/messages/bg3-save` — 202 `accepted` / `stale` (replay). */
export function postBg3SaveMessage(message: Bg3SaveMessage): Promise<CompanionIngestAck> {
    const init: RequestInit = { method: 'POST', body: JSON.stringify(message) };
    return fetchApi(`${COMPANION_API}/messages/${BG3_SAVE_CONTRACT_ID}`, init, CompanionIngestAckSchema);
}
