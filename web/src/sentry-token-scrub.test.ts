/**
 * ROK-1366: the magic-link fragment is stripped before Sentry.init, but the
 * browser's navigation PerformanceEntry keeps the ORIGINAL URL (fragment
 * included). browserTracing names the pageload's browser.request /
 * browser.response / browser.domContentLoadedEvent spans after that entry,
 * and Replay records it as a `navigation.navigate` performanceSpan. These
 * tests call the hooks sentry.ts actually configures with synthetic
 * payloads and assert the token never survives.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    replayIntegration: vi.fn((opts?: unknown) => ({ name: 'Replay', opts })),
    makeFetchTransport: vi.fn(() => ({ send: vi.fn(), flush: vi.fn() })),
    captureMessage: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
}));

const SECRET = 'SECRETtok.en-123';
const PAGE = `https://rl.test/events/42#token=${SECRET}`;
const PAGE_SCRUBBED = 'https://rl.test/events/42#token=[Filtered]';

type Hook = (event: unknown) => unknown;
interface InitConfig {
    beforeSendTransaction?: Hook;
    integrations: { name?: string; processEvent?: Hook }[];
}

const identity: Hook = (event) => event;
let config: InitConfig;
let recordingHook: Hook;

beforeAll(async () => {
    const Sentry = await import('@sentry/react');
    await import('./sentry');
    config = vi.mocked(Sentry.init).mock.calls[0][0] as unknown as InitConfig;
    const replayOpts = vi.mocked(Sentry.replayIntegration).mock.calls[0]?.[0];
    recordingHook =
        (replayOpts as { beforeAddRecordingEvent?: Hook } | undefined)
            ?.beforeAddRecordingEvent ?? identity;
});

function expectNoSecret(value: unknown): void {
    expect(JSON.stringify(value)).not.toContain(SECRET);
}

describe('ROK-1366: beforeSendTransaction scrubs the pageload transaction', () => {
    it('scrubs span descriptions, span data URLs, request.url and trace data', () => {
        const hook = config.beforeSendTransaction ?? identity;
        const out = hook({
            type: 'transaction',
            transaction: '/events/42',
            request: { url: PAGE },
            contexts: { trace: { data: { 'url.full': `/x?token=${SECRET}` } } },
            spans: [
                { op: 'browser.request', description: PAGE, data: {} },
                { op: 'browser.domContentLoadedEvent', description: PAGE, data: {} },
                {
                    op: 'http.client',
                    description: `GET /api/x?a=1&token=${SECRET}`,
                    data: {
                        url: `/api/x?a=1&token=${SECRET}`,
                        'http.query': `?a=1&token=${SECRET}`,
                        'http.fragment': `#token=${SECRET}`,
                        'http.method': 'GET',
                    },
                },
            ],
        }) as { spans: { description: string; data: Record<string, unknown> }[] };
        expectNoSecret(out);
        expect(out.spans[0].description).toBe(PAGE_SCRUBBED);
        expect(out.spans[2].data['http.method']).toBe('GET');
    });
});

describe('ROK-1366: Replay beforeAddRecordingEvent scrubs recorded URLs', () => {
    it('scrubs the navigation performance entry recorded at page load', () => {
        const out = recordingHook({
            type: 5,
            timestamp: 1,
            data: {
                tag: 'performanceSpan',
                payload: { op: 'navigation.navigate', description: PAGE, data: { size: 1 } },
            },
        }) as { data: { payload: { description: string } } };
        expectNoSecret(out);
        expect(out.data.payload.description).toBe(PAGE_SCRUBBED);
    });

    it('scrubs a history push (name + previous) and the rrweb meta href', () => {
        const push = recordingHook({
            type: 5,
            timestamp: 1,
            data: {
                tag: 'performanceSpan',
                payload: {
                    op: 'navigation.push',
                    description: `/join?intent=signup&token=${SECRET}`,
                    data: { previous: PAGE },
                },
            },
        });
        const meta = recordingHook({ type: 4, timestamp: 1, data: { href: PAGE, width: 1, height: 1 } });
        expectNoSecret(push);
        expectNoSecret(meta);
    });

    it('passes an unrelated rrweb event through unchanged', () => {
        const event = { type: 2, timestamp: 1, data: { node: { id: 1 } } };
        expect(recordingHook(event)).toEqual({ type: 2, timestamp: 1, data: { node: { id: 1 } } });
    });
});

describe('ROK-1366: replay_event urls are scrubbed by an event processor', () => {
    it('scrubs token URLs in the replay_event url list', () => {
        const processors = config.integrations
            .map((integration) => integration.processEvent)
            .filter((fn): fn is Hook => typeof fn === 'function');
        const out = processors.reduce((event, fn) => fn(event), {
            type: 'replay_event',
            urls: ['https://rl.test/events/42', `/join?intent=signup&token=${SECRET}`],
        } as unknown);
        expectNoSecret(out);
        expect((out as { urls: string[] }).urls[0]).toBe('https://rl.test/events/42');
    });
});
