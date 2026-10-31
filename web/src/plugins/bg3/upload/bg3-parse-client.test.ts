/**
 * ROK-1960 — the page side of the parse worker, with the Worker injected
 * (vitest has no real Worker). The worker is terminated once no parse is in
 * flight (WASM memory never shrinks), at once on a trap, a worker `error`, a
 * failed construction or a 60 s hang, and on `disposeBg3ParseWorker`; the
 * next parse gets a fresh one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bg3ParseError, type Bg3ParseErrorCode } from './bg3-parse-errors';
import {
    BG3_PARSE_TIMEOUT_MS, disposeBg3ParseWorker, inspectBg3SaveInWorker, setBg3ParseWorkerFactory, type Bg3ParseWorker,
} from './bg3-parse-client';
import type { Bg3ParseRequest, Bg3ParseResponse } from './bg3-parse-protocol';

class FakeWorker implements Bg3ParseWorker {
    onmessage: ((event: MessageEvent<Bg3ParseResponse>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    readonly posted: { message: Bg3ParseRequest; transfer: Transferable[] }[] = [];
    terminated = false;
    postMessage(message: Bg3ParseRequest, transfer: Transferable[]): void {
        this.posted.push({ message, transfer });
    }
    terminate(): void {
        this.terminated = true;
    }
    /** Answer the parse posted at `index` (default: the latest). */
    reply(build: (id: number) => Bg3ParseResponse, index = -1): void {
        const last = this.posted.at(index);
        if (!last) throw new Error('nothing was posted');
        this.onmessage?.(new MessageEvent('message', { data: build(last.message.id) }));
    }
}

let workers: FakeWorker[] = [];
const INSPECTION = { saveInfo: '{}', webp: null, thumbnail: null };

function must<T>(value: T | undefined, label: string): T {
    if (value === undefined) throw new Error(`missing ${label}`);
    return value;
}

async function codeOf(promise: Promise<unknown>): Promise<Bg3ParseErrorCode> {
    const error: unknown = await promise.then(() => null, (e: unknown) => e);
    if (!(error instanceof Bg3ParseError)) throw new Error(`expected a Bg3ParseError, got ${String(error)}`);
    return error.code;
}

beforeEach(() => {
    workers = [];
    setBg3ParseWorkerFactory(() => {
        const created = new FakeWorker();
        workers.push(created);
        return created;
    });
});

afterEach(() => {
    vi.useRealTimers();
    setBg3ParseWorkerFactory(null);
});

describe('inspectBg3SaveInWorker', () => {
    it('transfers the file buffer and resolves with the inspection', async () => {
        const bytes = new Uint8Array([1, 2]).buffer;
        const pending = inspectBg3SaveInWorker(bytes);
        const worker = must(workers[0], 'worker');
        expect(worker.posted[0]?.transfer).toEqual([bytes]);
        worker.reply((id) => ({ id, ok: true, inspection: INSPECTION }));
        await expect(pending).resolves.toEqual(INSPECTION);
    });

    it('rejects a coded error with that code', async () => {
        const first = inspectBg3SaveInWorker(new ArrayBuffer(1));
        must(workers[0], 'worker').reply((id) => ({ id, ok: false, code: 'corrupt_package' }));
        expect(await codeOf(first)).toBe('corrupt_package');
    });

    it('terminates the worker once the last in-flight parse settles, not before', async () => {
        const a = inspectBg3SaveInWorker(new ArrayBuffer(1));
        const b = inspectBg3SaveInWorker(new ArrayBuffer(1));
        const worker = must(workers[0], 'worker');
        worker.reply((id) => ({ id, ok: true, inspection: INSPECTION }), 0);
        await expect(a).resolves.toEqual(INSPECTION);
        expect(worker.terminated).toBe(false);
        worker.reply((id) => ({ id, ok: false, code: 'corrupt_package' }), 1);
        expect(await codeOf(b)).toBe('corrupt_package');
        expect(worker.terminated).toBe(true);
        const next = inspectBg3SaveInWorker(new ArrayBuffer(1));
        expect(workers).toHaveLength(2);
        disposeBg3ParseWorker();
        expect(await codeOf(next)).toBe('reader_failed');
    });
});

describe('inspectBg3SaveInWorker — hangs and dispose', () => {

    it('a parse past the timeout rejects reader_failed and terminates the hung worker', async () => {
        vi.useFakeTimers();
        const hung = inspectBg3SaveInWorker(new ArrayBuffer(1));
        const outcome = codeOf(hung);
        vi.advanceTimersByTime(BG3_PARSE_TIMEOUT_MS - 1);
        expect(must(workers[0], 'worker').terminated).toBe(false);
        vi.advanceTimersByTime(1);
        expect(must(workers[0], 'worker').terminated).toBe(true);
        expect(await outcome).toBe('reader_failed');
    });

    it('disposeBg3ParseWorker rejects the in-flight parse and terminates the worker', async () => {
        const inFlight = inspectBg3SaveInWorker(new ArrayBuffer(1));
        disposeBg3ParseWorker();
        expect(await codeOf(inFlight)).toBe('reader_failed');
        expect(must(workers[0], 'worker').terminated).toBe(true);
    });

    it('turns a trap into reader_failed, terminates the worker and recreates it next time', async () => {
        const trapped = inspectBg3SaveInWorker(new ArrayBuffer(1));
        must(workers[0], 'worker').reply((id) => ({ id, ok: false, code: null }));
        expect(await codeOf(trapped)).toBe('reader_failed');
        expect(workers[0]?.terminated).toBe(true);
        const retry = inspectBg3SaveInWorker(new ArrayBuffer(1));
        expect(workers).toHaveLength(2);
        must(workers[1], 'fresh worker').reply((id) => ({ id, ok: true, inspection: INSPECTION }));
        await expect(retry).resolves.toEqual(INSPECTION);
    });

    it('fails every in-flight parse and terminates on a worker error event', async () => {
        const a = inspectBg3SaveInWorker(new ArrayBuffer(1));
        const b = inspectBg3SaveInWorker(new ArrayBuffer(1));
        must(workers[0], 'worker').onerror?.(new ErrorEvent('error'));
        expect([await codeOf(a), await codeOf(b)]).toEqual(['reader_failed', 'reader_failed']);
        expect(workers[0]?.terminated).toBe(true);
    });

    it('rejects with reader_failed when the worker cannot be constructed', async () => {
        setBg3ParseWorkerFactory(() => {
            throw new DOMException('blocked by CSP', 'SecurityError');
        });
        expect(await codeOf(inspectBg3SaveInWorker(new ArrayBuffer(1)))).toBe('reader_failed');
    });
});
