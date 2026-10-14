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
import { at } from './test/defined';

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    addIntegration: vi.fn(),
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
    beforeSend?: Hook;
    beforeSendTransaction?: Hook;
    integrations: { name?: string; processEvent?: Hook }[];
}

const identity: Hook = (event) => event;
let config: InitConfig;
let recordingHook: Hook;

beforeAll(async () => {
    // Replay is lazy-loaded only when a replay can be sampled (production).
    vi.stubEnv('PROD', true);
    const Sentry = await import('@sentry/react');
    await import('./sentry');
    await vi.dynamicImportSettled();
    config = at(vi.mocked(Sentry.init).mock.calls, 0)[0] as unknown as InitConfig;
    const replayOpts = at(vi.mocked(Sentry.replayIntegration).mock.calls, 0)[0];
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
        expect(out.spans[0]?.description).toBe(PAGE_SCRUBBED);
        expect(out.spans[2]?.data['http.method']).toBe('GET');
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

    it('scrubs a history push (name + previous)', () => {
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
        expectNoSecret(push);
    });

    // No rrweb Meta (type 4) case on purpose. At runtime Replay hands
    // beforeAddRecordingEvent only type-5 custom events, so a synthetic Meta
    // event scrubbed here would pass while the real Meta `href` ships as-is.
    // The Meta href is clean only if the URL is clean when recording starts:
    // the magic-link fragment relies on being stripped before Sentry.init
    // (magic-link-capture.test.ts), and the join page's intent `?token=` is
    // not stripped at all (TECH-DEBT-BACKLOG.md, 2026-09-27).

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

describe('ROK-1750: beforeSend scrubs the poll share token from error events', () => {
    // browserTracing names the pageload/navigation after location.pathname and
    // sets it as the scope's transaction name, so an error raised on the
    // share page carries the path token in event.transaction.
    const SHARE_TOKEN = 'Abc_def-0123456789ABCDEFGHIJKLMNOPQRSTUVWXY';

    it('scrubs event.transaction and trace data on an error event', () => {
        const hook = config.beforeSend ?? identity;
        const out = hook({
            exception: { values: [{ type: 'TypeError', value: 'boom' }] },
            transaction: `/p/poll/${SHARE_TOKEN}`,
            contexts: { trace: { data: { 'url.full': `https://rl.test/p/poll/${SHARE_TOKEN}` } } },
        }) as { transaction: string };
        expect(JSON.stringify(out)).not.toContain(SHARE_TOKEN);
        expect(out.transaction).toBe('/p/poll/[Filtered]');
    });

    // R6: HttpContext copies document.referrer into request.headers.Referer,
    // and same-origin Referrer-Policy keeps the full /p/poll/<t> path.
    const REFERER = `https://rl.test/p/poll/${SHARE_TOKEN}`;
    const REFERER_SCRUBBED = 'https://rl.test/p/poll/[Filtered]';
    type WithHeaders = { request: { headers: Record<string, string> } };

    it('scrubs request.headers.Referer on an error event', () => {
        const hook = config.beforeSend ?? identity;
        const out = hook({
            exception: { values: [{ type: 'TypeError', value: 'boom' }] },
            request: { url: 'https://rl.test/events', headers: { Referer: REFERER } },
        }) as WithHeaders;
        expect(out.request.headers.Referer).toBe(REFERER_SCRUBBED);
    });

    it('scrubs request.headers.Referer on a transaction event', () => {
        const hook = config.beforeSendTransaction ?? identity;
        const out = hook({
            type: 'transaction',
            transaction: '/events',
            request: { url: 'https://rl.test/events', headers: { Referer: REFERER } },
        }) as WithHeaders;
        expect(out.request.headers.Referer).toBe(REFERER_SCRUBBED);
    });
});
