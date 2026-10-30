/**
 * ROK-1960 — the page side of the parse worker, with the Worker injected
 * (vitest has no real Worker). A coded error keeps the worker; a trap, a
 * worker `error` or a failed construction terminates it, and the next parse
 * gets a fresh one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bg3ParseError, type Bg3ParseErrorCode } from './bg3-parse-errors';
import { inspectBg3SaveInWorker, setBg3ParseWorkerFactory, type Bg3ParseWorker } from './bg3-parse-client';
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
    reply(build: (id: number) => Bg3ParseResponse): void {
        const last = this.posted.at(-1);
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

afterEach(() => setBg3ParseWorkerFactory(null));

describe('inspectBg3SaveInWorker', () => {
    it('transfers the file buffer and resolves with the inspection', async () => {
        const bytes = new Uint8Array([1, 2]).buffer;
        const pending = inspectBg3SaveInWorker(bytes);
        const worker = must(workers[0], 'worker');
        expect(worker.posted[0]?.transfer).toEqual([bytes]);
        worker.reply((id) => ({ id, ok: true, inspection: INSPECTION }));
        await expect(pending).resolves.toEqual(INSPECTION);
    });

    it('rejects a coded error with that code and keeps the worker', async () => {
        const first = inspectBg3SaveInWorker(new ArrayBuffer(1));
        must(workers[0], 'worker').reply((id) => ({ id, ok: false, code: 'corrupt_package' }));
        expect(await codeOf(first)).toBe('corrupt_package');
        const second = inspectBg3SaveInWorker(new ArrayBuffer(1));
        must(workers[0], 'worker').reply((id) => ({ id, ok: true, inspection: INSPECTION }));
        await expect(second).resolves.toEqual(INSPECTION);
        expect(workers).toHaveLength(1);
        expect(workers[0]?.terminated).toBe(false);
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
