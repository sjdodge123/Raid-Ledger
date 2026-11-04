/**
 * ROK-1960 — the worker-side handler: the reader's typed errors become codes
 * inside the worker (an Error's `code` does not survive structured clone),
 * anything else becomes `code: null`, and the WebP buffer is transferred.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBg3ParseRequest } from './bg3-parse-protocol';
import type { Bg3SaveInspection } from './vendor/rl_collectors_web';

/** What the reader hands back; `gameIdKey` is optional so a reader that omits it can be modelled. */
type ReaderOutput = Omit<Bg3SaveInspection, 'gameIdKey'> & { gameIdKey?: string | null };
const inspectBg3Save = vi.fn<(bytes: Uint8Array) => ReaderOutput>();
const loadBg3Wasm = vi.fn();
vi.mock('./bg3-wasm', () => ({ loadBg3Wasm: () => loadBg3Wasm() }));

const THUMB = { sha256: 'a'.repeat(64), byteLength: 3, width: 2, height: 1 };

function wasmError(code: string): Error {
    return Object.assign(new Error(`bg3 save: ${code}`), { name: 'Bg3SaveError', code });
}

beforeEach(() => {
    inspectBg3Save.mockReset().mockReturnValue({ saveInfo: '{}', webp: new Uint8Array([1, 2, 3]), thumbnail: THUMB, gameIdKey: null });
    loadBg3Wasm.mockReset().mockResolvedValue({ inspectBg3Save });
});

describe('handleBg3ParseRequest', () => {
    it('returns a plain inspection and transfers the WebP buffer', async () => {
        const { response, transfer } = await handleBg3ParseRequest({ id: 7, bytes: new Uint8Array([9, 8]).buffer });
        expect(Array.from(inspectBg3Save.mock.calls[0]?.[0] ?? [])).toEqual([9, 8]);
        expect(response).toEqual({ id: 7, ok: true, inspection: { saveInfo: '{}', webp: new Uint8Array([1, 2, 3]), thumbnail: THUMB, gameIdKey: null } });
        expect(transfer).toHaveLength(1);
        expect(response.ok && transfer[0]).toBe(response.ok && response.inspection.webp?.buffer);
    });

    it('carries the reader\'s gameIdKey across, and an absent one as null (ROK-2070)', async () => {
        const gameIdKey = 'b'.repeat(64);
        inspectBg3Save.mockReturnValueOnce({ saveInfo: '{}', webp: null, thumbnail: null, gameIdKey });
        const withKey = await handleBg3ParseRequest({ id: 2, bytes: new ArrayBuffer(1) });
        inspectBg3Save.mockReturnValueOnce({ saveInfo: '{}', webp: null, thumbnail: null });
        const absent = await handleBg3ParseRequest({ id: 3, bytes: new ArrayBuffer(1) });
        const keys = [withKey, absent].map(({ response }) => (response.ok ? response.inspection.gameIdKey : 'not ok'));
        expect(keys).toEqual([gameIdKey, null]);
    });

    it('transfers nothing when the save has no thumbnail', async () => {
        inspectBg3Save.mockReturnValue({ saveInfo: '{}', webp: null, thumbnail: null, gameIdKey: null });
        const { response, transfer } = await handleBg3ParseRequest({ id: 1, bytes: new ArrayBuffer(1) });
        expect(response).toEqual({ id: 1, ok: true, inspection: { saveInfo: '{}', webp: null, thumbnail: null, gameIdKey: null } });
        expect(transfer).toEqual([]);
    });

    it.each([
        ['not_lspk', 'not_a_save'],
        ['unsupported_version', 'not_a_save'],
        ['unsupported_package', 'unsupported_package'],
        ['corrupt_package', 'corrupt_package'],
        ['missing_save_info', 'missing_save_info'],
        ['invalid_save_info', 'invalid_save_info'],
    ] as const)('maps the reader code %s to %s', async (wasmCode, code) => {
        inspectBg3Save.mockImplementation(() => {
            throw wasmError(wasmCode);
        });
        expect((await handleBg3ParseRequest({ id: 2, bytes: new ArrayBuffer(1) })).response).toEqual({ id: 2, ok: false, code });
    });

    it('reports a trap as code null', async () => {
        inspectBg3Save.mockImplementation(() => {
            throw new WebAssembly.RuntimeError('unreachable');
        });
        expect((await handleBg3ParseRequest({ id: 3, bytes: new ArrayBuffer(1) })).response).toEqual({ id: 3, ok: false, code: null });
    });

    it('reports a failed WASM load as code null', async () => {
        loadBg3Wasm.mockRejectedValue(new TypeError('Failed to fetch'));
        expect((await handleBg3ParseRequest({ id: 4, bytes: new ArrayBuffer(1) })).response).toEqual({ id: 4, ok: false, code: null });
    });
});
