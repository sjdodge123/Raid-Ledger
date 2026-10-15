import { describe, it, expect, vi } from 'vitest';

const reactHandler = vi.fn();
vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    addIntegration: vi.fn(),
    browserTracingIntegration: vi.fn(() => 'browserTracingIntegration'),
    replayIntegration: vi.fn(() => 'replayIntegration'),
    makeFetchTransport: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    reactErrorHandler: vi.fn(() => reactHandler),
    flush: vi.fn(() => Promise.resolve(true)),
}));

type SentryModule = typeof import('./sentry');

/** A fresh sentry.ts (and boot buffer) per test, with the mock's call log cleared. */
async function freshSentry(): Promise<{ app: SentryModule; captureException: ReturnType<typeof vi.fn> }> {
    vi.resetModules();
    const Sentry = await import('@sentry/react');
    const captureException = vi.mocked(Sentry.captureException);
    captureException.mockClear();
    reactHandler.mockClear();
    return { app: await import('./sentry'), captureException };
}

function fireWindowError(error: Error): void {
    // Vitest's jsdom env rethrows a window 'error' event as an uncaught
    // exception when no user listener exists — exactly the closed-buffer state
    // these tests assert. A no-op listener stands in for the page's own.
    const pageListener = (): void => {};
    window.addEventListener('error', pageListener);
    try {
        window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    } finally {
        window.removeEventListener('error', pageListener);
    }
}

function fireRejection(reason: unknown): void {
    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    Object.defineProperty(event, 'reason', { value: reason });
    window.dispatchEvent(event);
}

describe('startup errors while the telemetry decision is pending (ROK-1779)', () => {
    it('holds a window error, a rejection and a root-handler error, then sends them after init when ON', async () => {
        const { app, captureException } = await freshSentry();
        const early = new Error('boot crash');
        const rejected = new Error('boot rejection');
        const rendered = new Error('render crash');
        fireWindowError(early);
        fireRejection(rejected);
        app.captureReactError(rendered, { componentStack: '\n at App' });
        expect(captureException, 'nothing may be sent before the decision').not.toHaveBeenCalled();

        expect(app.initSentry(true)).toBe(true);

        const sent = captureException.mock.calls.map(([error]) => error);
        expect(sent).toEqual([early, rejected, rendered]);
        expect(captureException).toHaveBeenCalledWith(rendered, {
            tags: { 'boot.buffered': 'react-root' },
            contexts: { react: { componentStack: '\n at App' } },
        });
    });

    it('drops every held error when telemetry is OFF, and sends nothing afterwards', async () => {
        const { app, captureException } = await freshSentry();
        fireWindowError(new Error('boot crash'));
        app.bufferBoundaryError(new Error('boundary crash'), '\n at Page');

        expect(app.initSentry(false)).toBe(false);
        fireWindowError(new Error('later crash'));
        app.captureReactError(new Error('later render'), {});

        expect(captureException).not.toHaveBeenCalled();
        expect(reactHandler).not.toHaveBeenCalled();
    });

    it('queues one error reported by both the root handler and the ErrorBoundary once', async () => {
        const { app, captureException } = await freshSentry();
        const caught = new Error('caught render crash');
        app.bufferBoundaryError(caught, '\n at Page');
        app.captureReactError(caught, { componentStack: '\n at Page' });

        app.initSentry(true);

        expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('holds at most MAX_PENDING errors, keeping the earliest', async () => {
        const { app, captureException } = await freshSentry();
        const { MAX_PENDING } = await import('./lib/sentry-boot-buffer');
        const errors = Array.from({ length: MAX_PENDING + 5 }, (_, i) => new Error(`e${i}`));
        errors.forEach((e) => app.captureReactError(e, {}));

        app.initSentry(true);

        const sent = captureException.mock.calls.map(([error]) => error);
        expect(sent).toEqual(errors.slice(0, MAX_PENDING));
    });

    it('does not double-capture once Sentry is live: the buffer is closed and its listeners removed', async () => {
        const { app, captureException } = await freshSentry();
        app.initSentry(true);
        const live = new Error('live crash');

        fireWindowError(live);
        app.bufferBoundaryError(live, '\n at Page');
        app.captureReactError(live, {});

        expect(captureException, 'Sentry reports live errors itself').not.toHaveBeenCalled();
        expect(reactHandler).toHaveBeenCalledTimes(1);
        expect(reactHandler).toHaveBeenCalledWith(live, {});
    });
});
