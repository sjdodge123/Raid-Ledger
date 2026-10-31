/**
 * ROK-1960 — the message protocol between the page and the BG3 parse worker,
 * plus the worker-side handler (kept here, out of the worker entry, so it is
 * unit-testable without a real `Worker`).
 *
 * The reader's typed `Bg3SaveError` is classified INSIDE the worker: an Error's
 * own `code` property does not survive structured clone. `code: null` means
 * anything else (a trap, a failed init) — the page treats it as
 * `reader_failed` and terminates the worker.
 */
import { wasmErrorCode, type Bg3ParseErrorCode } from './bg3-parse-errors';
import { loadBg3Wasm } from './bg3-wasm';
import type { Bg3SaveInspection } from './vendor/rl_collectors_web';

export interface Bg3ParseRequest {
    readonly id: number;
    /** The whole `.lsv`, transferred (not copied) to the worker. */
    readonly bytes: ArrayBuffer;
}

export type Bg3ParseResponse =
    | { readonly id: number; readonly ok: true; readonly inspection: Bg3SaveInspection }
    | { readonly id: number; readonly ok: false; readonly code: Bg3ParseErrorCode | null };

export interface Bg3ParseReply {
    readonly response: Bg3ParseResponse;
    readonly transfer: Transferable[];
}

/** Inspect one save; never throws. The WebP buffer is handed back as a transfer. */
export async function handleBg3ParseRequest(request: Bg3ParseRequest): Promise<Bg3ParseReply> {
    try {
        const reader = await loadBg3Wasm();
        const { saveInfo, webp, thumbnail } = reader.inspectBg3Save(new Uint8Array(request.bytes));
        // A plain object (structured clone drops class getters) with an own-buffer WebP copy to transfer.
        const ownWebp = webp ? new Uint8Array(webp) : null;
        const inspection: Bg3SaveInspection = { saveInfo, webp: ownWebp, thumbnail: thumbnail ? { ...thumbnail } : null };
        return { response: { id: request.id, ok: true, inspection }, transfer: ownWebp ? [ownWebp.buffer] : [] };
    } catch (error) {
        return { response: { id: request.id, ok: false, code: wasmErrorCode(error) }, transfer: [] };
    }
}
