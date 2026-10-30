/**
 * ROK-1960 — page side of the BG3 parse worker. One worker is created on the
 * first parse and reused; it is TERMINATED (and recreated on the next parse)
 * after anything other than the reader's own typed error — a WASM trap, a
 * failed init, a worker `error`/`messageerror` — because the wasm-bindgen
 * glue would otherwise keep a broken instance. Every failure is a
 * `Bg3ParseError`.
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

interface Pending {
    resolve(inspection: Bg3SaveInspection): void;
    reject(error: Bg3ParseError): void;
}

let factory: Bg3ParseWorkerFactory = defaultFactory;
let worker: Bg3ParseWorker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Reject every in-flight parse and kill the worker; the next parse gets a fresh one. */
function failAll(): void {
    const waiting = [...pending.values()];
    pending.clear();
    worker?.terminate();
    worker = null;
    for (const p of waiting) p.reject(new Bg3ParseError('reader_failed'));
}

function settle(response: Bg3ParseResponse): void {
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.inspection);
    else if (response.code) waiting.reject(new Bg3ParseError(response.code));
    else {
        waiting.reject(new Bg3ParseError('reader_failed'));
        failAll();
    }
}

function ensureWorker(): Bg3ParseWorker {
    if (worker) return worker;
    const created = factory();
    created.onmessage = (event) => settle(event.data);
    created.onerror = () => failAll();
    created.onmessageerror = () => failAll();
    worker = created;
    return created;
}

/** Inspect one save in the worker. `bytes` is transferred: it is detached afterwards. */
export function inspectBg3SaveInWorker(bytes: ArrayBuffer): Promise<Bg3SaveInspection> {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        try {
            const target = ensureWorker();
            pending.set(id, { resolve, reject });
            target.postMessage({ id, bytes }, [bytes]);
        } catch {
            pending.delete(id);
            failAll();
            reject(new Bg3ParseError('reader_failed'));
        }
    });
}

/** Tests only: swap the worker factory (`null` restores the real one) and drop the current worker. */
export function setBg3ParseWorkerFactory(next: Bg3ParseWorkerFactory | null): void {
    failAll();
    factory = next ?? defaultFactory;
}
