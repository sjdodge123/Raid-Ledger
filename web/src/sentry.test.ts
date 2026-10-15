import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { at } from './test/defined';

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    addIntegration: vi.fn(),
    browserTracingIntegration: vi.fn(() => 'browserTracingIntegration'),
    replayIntegration: vi.fn(() => 'replayIntegration'),
    makeFetchTransport: vi.fn(() => ({
        send: vi.fn(),
        flush: vi.fn(() => Promise.resolve(true)),
    })),
    captureMessage: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
}));

type SentryEvent = {
    exception?: { values?: { type?: string; value?: string }[] };
};
type BeforeSend = (event: SentryEvent) => SentryEvent | null;

describe('web Sentry beforeSend (ROK-1162)', () => {
    let beforeSend: BeforeSend;

    beforeEach(async () => {
        vi.resetModules();
        const Sentry = await import('@sentry/react');
        const initMock = Sentry.init as unknown as ReturnType<typeof vi.fn>;
        initMock.mockClear();
        (await import('./sentry')).initSentry(true);
        const config = at(initMock.mock.calls, 0)[0] as { beforeSend: BeforeSend };
        beforeSend = config.beforeSend;
    });

    it('drops AbortError typed events', () => {
        const result = beforeSend({
            exception: {
                values: [{ type: 'AbortError', value: 'The operation was aborted' }],
            },
        });
        expect(result).toBeNull();
    });

    it('drops DOMException whose value mentions abort', () => {
        const result = beforeSend({
            exception: {
                values: [
                    {
                        type: 'DOMException',
                        value: 'The user aborted a request.',
                    },
                ],
            },
        });
        expect(result).toBeNull();
    });

    it('does NOT drop unrelated DOMException events', () => {
        const event: SentryEvent = {
            exception: {
                values: [{ type: 'DOMException', value: 'QuotaExceededError' }],
            },
        };
        expect(beforeSend(event)).toBe(event);
    });

    it('passes through unrelated TypeErrors', () => {
        const event: SentryEvent = {
            exception: {
                values: [
                    {
                        type: 'TypeError',
                        value: "Cannot read property 'x' of undefined",
                    },
                ],
            },
        };
        expect(beforeSend(event)).toBe(event);
    });

    it('passes through events without an exception payload', () => {
        const event: SentryEvent = {};
        expect(beforeSend(event)).toBe(event);
    });
});

type ScrubCrumb = { category?: string; data?: Record<string, unknown> };
type ScrubEvent = { request?: { url?: string } };
interface ScrubConfig {
    beforeSend: (event: ScrubEvent) => ScrubEvent | null;
    beforeBreadcrumb?: (crumb: ScrubCrumb) => ScrubCrumb | null;
}

describe('web Sentry magic-link token scrubbing (ROK-1366)', () => {
    let config: ScrubConfig;

    beforeEach(async () => {
        vi.resetModules();
        const Sentry = await import('@sentry/react');
        const initMock = Sentry.init as unknown as ReturnType<typeof vi.fn>;
        initMock.mockClear();
        (await import('./sentry')).initSentry(true);
        config = at(initMock.mock.calls, 0)[0] as ScrubConfig;
    });

    it('scrubs a fragment token from navigation breadcrumbs', () => {
        expect(config.beforeBreadcrumb, 'Sentry.init needs a beforeBreadcrumb scrubber').toBeTypeOf('function');
        const crumb = config.beforeBreadcrumb!({
            category: 'navigation',
            data: { from: '/events/1#token=abc', to: '/events/1' },
        });
        expect(crumb?.data).toEqual({ from: '/events/1#token=[Filtered]', to: '/events/1' });
    });

    it('scrubs a fragment token from the event request url', () => {
        const event = config.beforeSend({ request: { url: 'https://rl.test/e#token=abc' } });
        expect(event?.request?.url).toBe('https://rl.test/e#token=[Filtered]');
    });
});

type MockFn = ReturnType<typeof vi.fn>;
interface ReplayConfig {
    integrations: unknown[];
    replaysOnErrorSampleRate: number;
}

describe('web Sentry Replay is lazy-loaded (Sentry 11 upgrade)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    async function loadSentry(prod: boolean) {
        vi.resetModules();
        vi.stubEnv('PROD', prod);
        const Sentry = await import('@sentry/react');
        for (const fn of [Sentry.init, Sentry.replayIntegration, Sentry.addIntegration]) {
            (fn as unknown as MockFn).mockClear();
        }
        (await import('./sentry')).initSentry(true);
        const initMock = Sentry.init as unknown as MockFn;
        return { Sentry, config: at(initMock.mock.calls, 0)[0] as ReplayConfig };
    }

    it('keeps Replay out of the integrations handed to Sentry.init', async () => {
        const { Sentry, config } = await loadSentry(true);
        expect(config.integrations).not.toContain('replayIntegration');
        expect(Sentry.replayIntegration).not.toHaveBeenCalled();
        expect(config.replaysOnErrorSampleRate).toBe(1);
    });

    it('adds Replay after init with the scrubbing beforeAddRecordingEvent', async () => {
        const { Sentry } = await loadSentry(true);
        await vi.dynamicImportSettled();
        const { scrubRecordingEvent } = await import('./lib/sentry-scrub-events');
        expect(Sentry.replayIntegration).toHaveBeenCalledWith({ beforeAddRecordingEvent: scrubRecordingEvent });
        expect(Sentry.addIntegration).toHaveBeenCalledWith('replayIntegration');
    });

    it('never loads Replay when no replay can be sampled (non-production)', async () => {
        const { Sentry, config } = await loadSentry(false);
        await vi.dynamicImportSettled();
        expect(config.replaysOnErrorSampleRate).toBe(0);
        expect(Sentry.addIntegration).not.toHaveBeenCalled();
    });
});

describe('web Sentry Replay chunk-load failure (Sentry 11 upgrade)', () => {
    let rejections: unknown[];
    const onRejection = (reason: unknown) => rejections.push(reason);

    beforeEach(() => {
        rejections = [];
        process.on('unhandledRejection', onRejection);
    });

    afterEach(() => {
        process.off('unhandledRejection', onRejection);
        vi.doUnmock('./lib/sentry-replay');
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('swallows a rejected Replay import without an unhandled rejection', async () => {
        vi.resetModules();
        vi.stubEnv('PROD', true);
        vi.doMock('./lib/sentry-replay', () => {
            throw new Error('chunk load failed');
        });
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const Sentry = await import('@sentry/react');
        (Sentry.init as unknown as MockFn).mockClear();
        (Sentry.addIntegration as unknown as MockFn).mockClear();
        (await import('./sentry')).initSentry(true);
        await vi.dynamicImportSettled();
        await new Promise((resolve) => setImmediate(resolve));
        expect(rejections, 'Replay import rejection must be handled').toEqual([]);
        expect(debug).toHaveBeenCalledWith('[sentry] Replay chunk failed to load', expect.any(Error));
        expect(Sentry.init).toHaveBeenCalledTimes(1);
        expect(Sentry.addIntegration).not.toHaveBeenCalled();
    });
});

describe('web Sentry v11 privacy options pin the v10 baseline', () => {
    it('passes static lifecycle, the v10 dataCollection and no attached stacktraces', async () => {
        vi.resetModules();
        const Sentry = await import('@sentry/react');
        const initMock = Sentry.init as unknown as MockFn;
        initMock.mockClear();
        (await import('./sentry')).initSentry(true);
        const config = at(initMock.mock.calls, 0)[0] as Record<string, unknown>;
        const deny = { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] };
        expect({
            traceLifecycle: config['traceLifecycle'],
            dataCollection: config['dataCollection'],
            attachStacktrace: config['attachStacktrace'],
        }).toEqual({
            traceLifecycle: 'static',
            dataCollection: {
                userInfo: false,
                cookies: false,
                httpHeaders: { request: deny, response: deny },
                httpBodies: [],
                urlQueryParams: deny,
                genAI: { inputs: false, outputs: false },
                databaseQueryData: false,
                queues: false,
                graphQL: { document: false, variables: false },
            },
            attachStacktrace: false,
        });
    });
});

describe('web Sentry runtime opt-out gate (ROK-1779)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    async function freshSentry() {
        vi.resetModules();
        const Sentry = await import('@sentry/react');
        for (const fn of [Sentry.init, Sentry.captureMessage]) {
            (fn as unknown as MockFn).mockClear();
        }
        const mod = await import('./sentry');
        return { Sentry, mod };
    }

    it('does not initialise at import time', async () => {
        const { Sentry, mod } = await freshSentry();
        expect(Sentry.init, 'importing sentry.ts must not call Sentry.init').not.toHaveBeenCalled();
        expect(mod.isTelemetryActive()).toBe(false);
    });

    it.each([false, undefined])('does not initialise when the server flag is %s', async (flag) => {
        const { Sentry, mod } = await freshSentry();
        expect(mod.initSentry(flag)).toBe(false);
        expect(Sentry.init).not.toHaveBeenCalled();
        expect(mod.isTelemetryActive()).toBe(false);
    });

    it('does not initialise when the build disables telemetry, even if the server allows it', async () => {
        vi.stubEnv('VITE_DISABLE_TELEMETRY', 'true');
        const { Sentry, mod } = await freshSentry();
        expect(mod.initSentry(true)).toBe(false);
        expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('initialises once when the server allows it, however often it is called', async () => {
        const { Sentry, mod } = await freshSentry();
        expect(mod.initSentry(true)).toBe(true);
        expect(mod.initSentry(true)).toBe(true);
        expect(Sentry.init).toHaveBeenCalledTimes(1);
        expect(mod.isTelemetryActive()).toBe(true);
    });

    it('keeps the first decision: a refused init is not re-opened by a later call', async () => {
        const { Sentry, mod } = await freshSentry();
        mod.initSentry(false);
        expect(mod.initSentry(true)).toBe(false);
        expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('passes dataCollection.userInfo === false (no default PII)', async () => {
        const { Sentry, mod } = await freshSentry();
        mod.initSentry(true);
        const config = at((Sentry.init as unknown as MockFn).mock.calls, 0)[0] as {
            dataCollection?: { userInfo?: unknown };
        };
        expect(config.dataCollection?.userInfo).toBe(false);
    });

    it('captureMessageVerified returns true and sends nothing when not initialised', async () => {
        const { Sentry, mod } = await freshSentry();
        mod.initSentry(false);
        await expect(mod.captureMessageVerified('[BUG] hi', {})).resolves.toBe(true);
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('captureMessageVerified sends the message when initialised', async () => {
        const { Sentry, mod } = await freshSentry();
        mod.initSentry(true);
        await expect(mod.captureMessageVerified('[BUG] hi', {})).resolves.toBe(true);
        expect(Sentry.captureMessage).toHaveBeenCalledWith('[BUG] hi', {});
    });
});
