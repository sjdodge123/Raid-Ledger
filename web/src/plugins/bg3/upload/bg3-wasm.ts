/**
 * ROK-1960 L1 — lazy loader for the vendored rl-collectors-web WASM reader
 * (spec D-3). The glue + `.wasm` are fetched only on the first parse (a
 * dynamic `import()`, so they never reach an eager chunk) and the
 * initialised module is cached for the rest of the session.
 *
 * `resetBg3Wasm()` drops the cache. The parse layer calls it after any
 * failure that is not the reader's own `Bg3SaveError` (a failed load, or a
 * trap such as `RuntimeError: unreachable` when the copied file does not fit
 * in WASM memory), so the next attempt loads again instead of reusing a
 * failed promise. A failed LOAD then re-instantiates; after a trap the
 * wasm-bindgen glue keeps its module-level instance, which is why the copy
 * for that case asks the user to reload.
 */
import type { Bg3SaveInspection } from './vendor/rl_collectors_web';

export interface Bg3WasmReader {
    inspectBg3Save(bytes: Uint8Array): Bg3SaveInspection;
}

let cached: Promise<Bg3WasmReader> | null = null;

async function instantiate(): Promise<Bg3WasmReader> {
    const glue = await import('./vendor/rl_collectors_web');
    await glue.default();
    return { inspectBg3Save: glue.inspectBg3Save };
}

/** The initialised reader; loads it on first use. A rejected load is not cached. */
export function loadBg3Wasm(): Promise<Bg3WasmReader> {
    if (cached) return cached;
    const pending = instantiate();
    cached = pending;
    pending.catch(() => {
        if (cached === pending) cached = null;
    });
    return pending;
}

/** Forget the cached reader so the next `loadBg3Wasm()` loads it again. */
export function resetBg3Wasm(): void {
    cached = null;
}
