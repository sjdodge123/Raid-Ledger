/**
 * ROK-1960 — page side of the BG3 parse worker. A worker is created for a
 * parse and TERMINATED as soon as no parse is in flight any more: WASM linear
 * memory only grows, so a kept worker would hold at least the largest save's
 * worth for the rest of the page's life. It is also terminated at once on a
 * WASM trap, a failed init, a worker `error`/`messageerror`, or a parse that
 * runs past `BG3_PARSE_TIMEOUT_MS` (a hung reader must not block later
 * parses). `disposeBg3ParseWorker` lets the upload sheet kill it on unmount.
 * Every failure is a `Bg3ParseError`.
 */
import { Bg3ParseError } from './bg3-parse-errors';
import type { Bg3ParseRequest, Bg3ParseResponse } from './bg3-parse-protocol';
import type { Bg3SaveInspection } from './vendor/rl_collectors_web';

/** The slice of `Worker` this module uses (a test injects a fake). */
export interface Bg3ParseWorker {
    onmessage: ((event: MessageEvent<Bg3ParseResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: ((event: MessageEvent) => void) | null;
    postMessage(message: Bg3ParseRequest, transfer: Transferable[]): void;
    terminate(): void;
}

export type Bg3ParseWorkerFactory = () => Bg3ParseWorker;

const defaultFactory: Bg3ParseWorkerFactory = () =>
    new Worker(new URL('./bg3-parse.worker.ts', import.meta.url), { type: 'module', name: 'bg3-parse' });

/** A parse still running after this long is treated as hung (spec §7 `reader_failed`). */
export const BG3_PARSE_TIMEOUT_MS = 60_000;

interface Pending {
    resolve(inspection: Bg3SaveInspection): void;
    reject(error: Bg3ParseError): void;
    timer: ReturnType<typeof setTimeout>;
}

let factory: Bg3ParseWorkerFactory = defaultFactory;
let worker: Bg3ParseWorker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Reject every in-flight parse (`reader_failed`) and terminate the worker; the next parse gets a fresh one. */
export function disposeBg3ParseWorker(): void {
    const waiting = [...pending.values()];
    pending.clear();
    worker?.terminate();
    worker = null;
    for (const p of waiting) {
        clearTimeout(p.timer);
        p.reject(new Bg3ParseError('reader_failed'));
    }
}

function settle(response: Bg3ParseResponse): void {
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    clearTimeout(waiting.timer);
    let trapped = false;
    if (response.ok) waiting.resolve(response.inspection);
    else if (response.code) waiting.reject(new Bg3ParseError(response.code));
    else {
        waiting.reject(new Bg3ParseError('reader_failed'));
        trapped = true;
    }
    // Trapped, or idle: free the WASM memory now rather than at page unload.
    if (trapped || pending.size === 0) disposeBg3ParseWorker();
}

function ensureWorker(): Bg3ParseWorker {
    if (worker) return worker;
    const created = factory();
    created.onmessage = (event) => settle(event.data);
    created.onerror = () => disposeBg3ParseWorker();
    created.onmessageerror = () => disposeBg3ParseWorker();
    worker = created;
    return created;
}

/** Inspect one save in the worker. `bytes` is transferred: it is detached afterwards. */
export function inspectBg3SaveInWorker(bytes: ArrayBuffer): Promise<Bg3SaveInspection> {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        try {
            const target = ensureWorker();
            const timer = setTimeout(disposeBg3ParseWorker, BG3_PARSE_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            target.postMessage({ id, bytes }, [bytes]);
        } catch {
            disposeBg3ParseWorker();
            reject(new Bg3ParseError('reader_failed'));
        }
    });
}

/** Tests only: swap the worker factory (`null` restores the real one) and drop the current worker. */
export function setBg3ParseWorkerFactory(next: Bg3ParseWorkerFactory | null): void {
    disposeBg3ParseWorker();
    factory = next ?? defaultFactory;
}
