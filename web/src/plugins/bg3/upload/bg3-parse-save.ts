/**
 * ROK-1960 L1 — a dropped/picked BG3 save → the normalised `bg3-save`
 * payload + its WebP thumbnail, entirely in the browser (spec D-2). The WASM
 * reader does only the binary work, in a dedicated worker; the payload is built by the contract's
 * own `normaliseBg3SaveInfo` and validated with `Bg3SavePayloadSchema`, so
 * this path cannot drift from the reference. Nothing here touches the
 * network. Every failure is a `Bg3ParseError`.
 */
import {
    Bg3SaveInfoRawSchema,
    Bg3SavePayloadSchema,
    normaliseBg3SaveInfo,
    type Bg3SavePayload,
    type CompanionWebpRef,
} from '@raid-ledger/contract';
import type { Bg3ParsedSave } from './bg3-upload-api';
import { Bg3ParseError } from './bg3-parse-errors';
import { inspectBg3SaveInWorker } from './bg3-parse-client';
import { hasSubtleCrypto, sha256HexSync } from './bg3-sha256';
import type { Bg3SaveInspection } from './vendor/rl_collectors_web';
import provenance from './vendor/PROVENANCE.json';

/** Client-side cap, checked before the file is read (D-5). */
export const BG3_SAVE_MAX_BYTES = 512 * 1024 * 1024;

/** The one `.lsv` to read, and the dropped folder's name (`null` for a bare file). */
export interface Bg3SaveSource {
    readonly file: File;
    readonly folderName: string | null;
}

const isLsv = (file: File): boolean => file.name.toLowerCase().endsWith('.lsv');

/** A dropped folder (or a bare file, `folderName` null) must hold exactly one `.lsv`. */
export function selectBg3SaveSource(files: readonly File[], folderName: string | null): Bg3SaveSource {
    const saves = files.filter(isLsv);
    const [file] = saves;
    if (saves.length !== 1 || !file) throw new Bg3ParseError('one_save_at_a_time');
    return { file, folderName };
}

/**
 * Lowercase hex SHA-256 of a UTF-8 string. WebCrypto when available; otherwise
 * the pure-JS fallback, because `crypto.subtle` is undefined in an insecure
 * context (the plain-HTTP LAN self-host) and every save would fail to hash.
 */
export async function sha256Hex(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    if (!hasSubtleCrypto()) return sha256HexSync(bytes);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The campaign key (CONTRACT §3.3): the hash of the save-folder name
 * (`save-folder`), or for a bare `.lsv` the hash of its file stem
 * (`file-name`, operator ruling). BG3 names the `.lsv` after its folder, so the
 * two usually give the same key; the source records which one was seen. The
 * raw name never leaves this function.
 */
async function campaignKeyOf(source: Bg3SaveSource): Promise<Pick<Bg3SavePayload, 'campaignKey' | 'campaignKeySource'>> {
    if (source.folderName !== null) return { campaignKey: await sha256Hex(source.folderName), campaignKeySource: 'save-folder' };
    return { campaignKey: await sha256Hex(source.file.name.replace(/\.lsv$/i, '')), campaignKeySource: 'file-name' };
}

interface SchemaIssues {
    readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string }[];
}

function firstIssuePath(error: SchemaIssues): string | null {
    const first = error.issues[0];
    return first ? first.path.map(String).join('.') || first.code : null;
}

/** The reader runs in a worker; the file's buffer is transferred, not copied. */
async function inspect(file: File): Promise<Bg3SaveInspection> {
    try {
        return await inspectBg3SaveInWorker(await file.arrayBuffer());
    } catch (error) {
        if (error instanceof Bg3ParseError) throw error;
        throw new Bg3ParseError('reader_failed');
    }
}

function thumbnailOf(inspection: Bg3SaveInspection): { ref: CompanionWebpRef; webp: Uint8Array<ArrayBuffer> } | null {
    const { thumbnail, webp } = inspection;
    if (!thumbnail || !webp) return null;
    return { ref: { ...thumbnail, contentType: 'image/webp' }, webp: new Uint8Array(webp) };
}

function parseSaveInfoJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        throw new Bg3ParseError('invalid_save_info');
    }
}

/** Read, inspect, normalise and validate one save. */
export async function parseBg3Save(source: Bg3SaveSource): Promise<Bg3ParsedSave> {
    if (source.file.size > BG3_SAVE_MAX_BYTES) throw new Bg3ParseError('too_large');
    const inspection = await inspect(source.file);
    const raw = Bg3SaveInfoRawSchema.safeParse(parseSaveInfoJson(inspection.saveInfo));
    if (!raw.success) throw new Bg3ParseError('invalid_payload', firstIssuePath(raw.error));
    const thumb = thumbnailOf(inspection);
    const normalised = normaliseBg3SaveInfo(raw.data, {
        savedAt: new Date(source.file.lastModified).toISOString(),
        ...(await campaignKeyOf(source)),
        thumbnail: thumb?.ref ?? null,
    });
    const payload = Bg3SavePayloadSchema.safeParse(normalised);
    if (!payload.success) throw new Bg3ParseError('invalid_payload', firstIssuePath(payload.error));
    return { payload: payload.data, webp: thumb?.webp ?? null, collectorVersion: provenance.crateVersion };
}
