/**
 * ROK-1960 L1 — the lazy WASM loader: one init per session, a failed load
 * is retried, and `resetBg3Wasm()` forces a fresh load. The glue is mocked;
 * the real `.wasm` is pinned by `bg3-wasm-provenance.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn<() => Promise<void>>();
const inspectBg3Save = vi.fn();
vi.mock('./vendor/rl_collectors_web', () => ({ default: () => init(), inspectBg3Save: (b: Uint8Array) => inspectBg3Save(b) }));

const { loadBg3Wasm, resetBg3Wasm } = await import('./bg3-wasm');

beforeEach(() => {
    resetBg3Wasm();
    init.mockReset().mockResolvedValue(undefined);
});

describe('loadBg3Wasm', () => {
    it('initialises the reader once and caches it', async () => {
        const first = await loadBg3Wasm();
        const second = await loadBg3Wasm();
        expect(second).toBe(first);
        expect(init).toHaveBeenCalledTimes(1);
        first.inspectBg3Save(new Uint8Array([1]));
        expect(inspectBg3Save).toHaveBeenCalledWith(new Uint8Array([1]));
    });

    it('does not cache a failed load, so the next call loads again', async () => {
        init.mockRejectedValueOnce(new Error('failed to fetch Wasm: 404'));
        await expect(loadBg3Wasm()).rejects.toThrow('failed to fetch Wasm: 404');
        await expect(loadBg3Wasm()).resolves.toBeDefined();
        expect(init).toHaveBeenCalledTimes(2);
    });

    it('loads again after resetBg3Wasm()', async () => {
        await loadBg3Wasm();
        resetBg3Wasm();
        await loadBg3Wasm();
        expect(init).toHaveBeenCalledTimes(2);
    });
});
