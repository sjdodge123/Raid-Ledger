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
        await import('./sentry');
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
        await import('./sentry');
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
        await import('./sentry');
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
