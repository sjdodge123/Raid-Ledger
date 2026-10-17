/**
 * ROK-1313 — `captureMessageVerified` sends feedback screenshots as Sentry
 * attachments on an isolated `withScope` scope (never `getCurrentScope`, which
 * would leave the screenshot on every later event).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scope = vi.hoisted(() => ({ addAttachment: vi.fn() }));
const order = vi.hoisted(() => [] as string[]);

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    addIntegration: vi.fn(),
    browserTracingIntegration: vi.fn(() => 'browserTracingIntegration'),
    replayIntegration: vi.fn(() => 'replayIntegration'),
    makeFetchTransport: vi.fn(() => ({ send: vi.fn(), flush: vi.fn(() => Promise.resolve(true)) })),
    captureMessage: vi.fn(() => { order.push('capture'); }),
    flush: vi.fn(() => Promise.resolve(true)),
    withScope: vi.fn((cb: (s: typeof scope) => void) => { order.push('withScope:start'); cb(scope); order.push('withScope:end'); }),
    getCurrentScope: vi.fn(() => scope),
}));

const ATTACHMENT = { filename: 'screenshot.png', data: new Uint8Array([0x89, 0x50]), contentType: 'image/png' };

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    order.length = 0;
    scope.addAttachment.mockImplementation(() => { order.push('attach'); });
});

describe('captureMessageVerified attachments (ROK-1313)', () => {
    it('adds each attachment on a withScope scope before capturing the message inside it', async () => {
        const Sentry = await import('@sentry/react');
        const { captureMessageVerified, initSentry } = await import('./sentry');
        initSentry(true);
        const ok = await captureMessageVerified('[BUG] broken', { level: 'error' }, [ATTACHMENT]);
        expect(ok).toBe(true);
        expect(Sentry.withScope).toHaveBeenCalledTimes(1);
        expect(scope.addAttachment).toHaveBeenCalledWith(ATTACHMENT);
        expect(order).toEqual(['withScope:start', 'attach', 'capture', 'withScope:end']);
        expect(Sentry.getCurrentScope).not.toHaveBeenCalled();
    });

    it('captures without a scope when there is nothing to attach', async () => {
        const Sentry = await import('@sentry/react');
        const { captureMessageVerified, initSentry } = await import('./sentry');
        initSentry(true);
        await captureMessageVerified('[IDEA] nice', { level: 'info' });
        expect(Sentry.withScope).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).toHaveBeenCalledWith('[IDEA] nice', { level: 'info' });
    });

    it('sends no attachment when telemetry is off (ROK-1838 opt-out)', async () => {
        const Sentry = await import('@sentry/react');
        const { captureMessageVerified, initSentry } = await import('./sentry');
        initSentry(false);
        await captureMessageVerified('[BUG] broken', { level: 'error' }, [ATTACHMENT]);
        expect(Sentry.withScope, 'opted-out instance must not open a scope').not.toHaveBeenCalled();
        expect(scope.addAttachment, 'opted-out instance must not attach the screenshot').not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
});
