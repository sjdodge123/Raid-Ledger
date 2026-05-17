import { describe, it, expect, beforeEach, vi } from 'vitest';

type ConsoleCaptureModule = typeof import('./feedback-console-capture');

async function loadCaptureModule(): Promise<ConsoleCaptureModule> {
    vi.resetModules();
    return await import('./feedback-console-capture');
}

describe('Regression: ROK-1312 — feedback console capture', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('captures window.error events as [ERROR] uncaught entries', async () => {
        const mod = await loadCaptureModule();
        const event = new ErrorEvent('error', {
            message: 'boom',
            filename: 'app.js',
            lineno: 42,
            colno: 7,
        });
        window.dispatchEvent(event);
        const logs = mod.getClientLogs();
        expect(logs).toMatch(/\[ERROR\] uncaught: boom @ app\.js:42:7/);
    });

    it('captures unhandled promise rejections', async () => {
        const mod = await loadCaptureModule();
        // jsdom does not reliably fire unhandledrejection from real
        // Promise.reject; dispatch a synthetic event with the reason field
        // forced on (the constructor exists in modern jsdom but ignores the
        // init dict's `reason` on some versions).
        const event = new Event('unhandledrejection') as PromiseRejectionEvent;
        Object.defineProperty(event, 'reason', {
            value: new Error('rejected-thing'),
            configurable: true,
        });
        window.dispatchEvent(event);
        const logs = mod.getClientLogs();
        expect(logs).toMatch(
            /\[ERROR\] unhandled rejection: Error: rejected-thing/,
        );
    });

    it('does not evict errors when console.log floods the buffer', async () => {
        const mod = await loadCaptureModule();
        console.error('the-one-error-we-need');
        for (let i = 0; i < 200; i++) console.log(`flood-${i}`);
        const logs = mod.getClientLogs();
        expect(logs).toContain('the-one-error-we-need');
    });
});
