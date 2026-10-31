/**
 * ROK-1960 — the vendored rl-collectors-web WASM reader, initialised once per
 * WORKER (spec D-3). Only `bg3-parse.worker.ts` imports this module, so the
 * glue + `.wasm` live in the worker's own chunk and never reach the page.
 *
 * A rejected init is not cached, so the next request loads again. A trap
 * (`RuntimeError: unreachable`, e.g. an allocation failure on a large save)
 * leaves the wasm-bindgen glue holding a broken module-level instance; the
 * page side recovers from that by terminating the whole worker
 * (`bg3-parse-client.ts`), which is the only reliable re-instantiate.
 */
import init, { inspectBg3Save, type Bg3SaveInspection } from './vendor/rl_collectors_web';

export interface Bg3WasmReader {
    inspectBg3Save(bytes: Uint8Array): Bg3SaveInspection;
}

let cached: Promise<Bg3WasmReader> | null = null;

async function instantiate(): Promise<Bg3WasmReader> {
    await init();
    return { inspectBg3Save };
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
