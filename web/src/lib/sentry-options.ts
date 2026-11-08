/**
 * ROK-1779: the browser `Sentry.init` options, moved out of sentry.ts so the
 * init itself can wait for the served telemetry flag. Each hook is a small
 * named helper so later layers can extend beforeSend / beforeSendTransaction
 * / beforeBreadcrumb without growing one function.
 */
import * as Sentry from '@sentry/react';
import { scrubBreadcrumb } from './sentry-scrub';
import { scrubPiiBreadcrumb, scrubPiiEvent } from './sentry-scrub-pii';
import {
    scrubErrorEvent,
    scrubReplayEventUrls,
    scrubTransactionEvent,
} from './sentry-scrub-events';
import { carriesEvent, reportUndeliveredSends } from './sentry-reporting-transport';

/** `@sentry/react` does not re-export it; derive it from the hook it feeds. */
type TransactionEvent = Parameters<NonNullable<Sentry.BrowserOptions['beforeSendTransaction']>>[0];

const SENTRY_DSN =
    'https://54d787fd4c3d48bc77a750b5e3f76bd5@o4510887305019392.ingest.us.sentry.io/4510887344799744';

/** Replay is never sampled for whole sessions; 100% on error in production. */
export function replaySampleRates(): { session: number; onError: number } {
    return { session: 0, onError: import.meta.env.PROD ? 1.0 : 0 };
}

/** Sentry v11's documented equivalent of the v10 `sendDefaultPii: false` default. */
const PII_KEY_DENY = { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] };
const V10_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: PII_KEY_DENY, response: PII_KEY_DENY },
    httpBodies: [],
    urlQueryParams: PII_KEY_DENY,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
} satisfies Sentry.BrowserOptions['dataCollection'];

/**
 * ROK-1162: TanStack Query cancels in-flight fetches on unmount / refetch;
 * the cancellation surfaces as AbortError or DOMException and is not a bug.
 */
function isAbortNoise(event: Sentry.ErrorEvent): boolean {
    const first = event.exception?.values?.[0];
    if (first?.type === 'AbortError') return true;
    return (
        first?.type === 'DOMException' &&
        typeof first.value === 'string' &&
        /abort/i.test(first.value)
    );
}

/**
 * Drops abort noise, then (ROK-1366 backstop + ROK-1750) scrubs a `token=` /
 * poll share token from request.url, transaction name and trace data. The
 * join page's intent `?token=` stays in the address bar, so it still reaches
 * the Replay Meta href (TECH-DEBT-BACKLOG.md, 2026-09-27). ROK-1779: then
 * strips usernames, emails and IPs (`sentry-scrub-pii.ts`).
 */
export function beforeSendError(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
    if (isAbortNoise(event)) return null;
    return scrubPiiEvent(scrubErrorEvent(event));
}

/**
 * ROK-1366: the navigation PerformanceEntry keeps the pre-strip URL
 * (fragment included) — scrub it from spans, replay and replay urls.
 */
export function beforeSendTransactionEvent(event: TransactionEvent): TransactionEvent | null {
    return scrubPiiEvent(scrubTransactionEvent(event));
}

export function beforeBreadcrumbScrub(
    breadcrumb: Sentry.Breadcrumb,
): Sentry.Breadcrumb | null {
    return scrubPiiBreadcrumb(scrubBreadcrumb(breadcrumb));
}

/**
 * Wraps the fetch transport so an undelivered event envelope (4xx/5xx, a
 * rate-limit drop with no status, a network error) is reported — see
 * sentry-reporting-transport.ts.
 */
function makeReportingTransport(
    onTransportFailure: () => void,
): NonNullable<Sentry.BrowserOptions['transport']> {
    return (options) => {
        const base = Sentry.makeFetchTransport(options);
        return {
            send: reportUndeliveredSends(
                (envelope: Parameters<typeof base.send>[0]) => base.send(envelope),
                onTransportFailure,
                (envelope) => carriesEvent(envelope),
            ),
            flush: (timeout) => base.flush(timeout),
        };
    };
}

/**
 * Scope tags every event starts with. ROK-2116: `__APP_VERSION__` is a Vite
 * `define` (replaced as a bare identifier at build time), so it must never be
 * read off `window` — that was always undefined and tagged every event
 * "unknown". vitest defines none, hence the `typeof` guard.
 */
export function initialTags(): Record<string, string> {
    const version: unknown = typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__;
    return {
        app_version: typeof version === 'string' && version ? version : 'unknown',
        deployment: window.location.hostname,
    };
}

export function buildSentryOptions(onTransportFailure: () => void): Sentry.BrowserOptions {
    const isProduction = import.meta.env.PROD;
    const replays = replaySampleRates();
    return {
        dsn: SENTRY_DSN,
        enabled: !['localhost', '127.0.0.1'].includes(window.location.hostname),
        environment: isProduction ? 'production' : 'development',
        tracesSampleRate: isProduction ? 0.1 : 1.0,
        replaysSessionSampleRate: replays.session,
        replaysOnErrorSampleRate: replays.onError,
        // Sentry v11 streams spans by default, which turns beforeSendTransaction
        // into a no-op and would skip the ROK-1366 scrub. Keep the v10
        // transaction model until it moves to beforeSendSpan.
        traceLifecycle: 'static',
        // v11 dropped sendDefaultPii; pin the v10 data-collection baseline.
        dataCollection: V10_DATA_COLLECTION,
        // v11 defaults this to true; keep v10 issue grouping.
        attachStacktrace: false,
        beforeSendTransaction: beforeSendTransactionEvent,
        // Replay is added lazily after init (lib/sentry-replay.ts).
        integrations: [
            Sentry.browserTracingIntegration(),
            { name: 'ScrubReplayUrls', processEvent: scrubReplayEventUrls },
        ],
        beforeSend: beforeSendError,
        beforeBreadcrumb: beforeBreadcrumbScrub,
        initialScope: { tags: initialTags() },
        transport: makeReportingTransport(onTransportFailure),
    };
}
