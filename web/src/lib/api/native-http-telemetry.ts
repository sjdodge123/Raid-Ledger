/**
 * ROK-1779 (Codex r5): network breadcrumbs + `http.client` spans for the
 * captured clients in `native-fetch.ts`.
 *
 * Sentry now initialises after the app bundle loads, so its fetch/XHR
 * auto-instrumentation wraps the globals AFTER `native-fetch.ts` captured
 * them — the captured clients (fetchApi, auth/refresh, avatar upload) would
 * otherwise never reach Sentry. Re-capturing the globals is NOT the fix: the
 * capture-at-load is the ROK-1754 protection against third-party replacement.
 * So the captured clients record their own telemetry here instead.
 *
 * - No-op unless a Sentry client is live (telemetry ON and initialised).
 * - Records only method, a scrubbed URL (query + fragment dropped, path
 *   share tokens / e-mails / IPs scrubbed), status and duration. Never
 *   request or response bodies, never headers.
 */
import * as Sentry from '@sentry/react';
import { scrubTokenFromUrl } from '../sentry-scrub';
import { scrubPiiString } from '../sentry-scrub-pii';

type FetchArgs = Parameters<typeof fetch>;

/** Path only: the query string and fragment never leave the browser. */
export function scrubRequestUrl(url: string): string {
    const path = url.split(/[?#]/, 1)[0] ?? '';
    return scrubPiiString(scrubTokenFromUrl(path));
}

function requestUrl(input: FetchArgs[0]): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

function requestMethod(input: FetchArgs[0], init: FetchArgs[1]): string {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    return method.toUpperCase();
}

function record(
    category: 'fetch' | 'xhr',
    data: { method: string; url: string; startedAt: number; status?: number },
): void {
    const { method, url, startedAt, status } = data;
    Sentry.addBreadcrumb({
        category,
        type: 'http',
        level: status !== undefined && status >= 400 ? 'warning' : 'info',
        data: {
            method,
            url,
            ...(status === undefined ? {} : { status_code: status }),
            duration_ms: Math.round(performance.now() - startedAt),
        },
    });
}

/** Run a captured fetch, recording a breadcrumb + span when telemetry is ON. */
export function traceNativeFetch(
    run: (...args: FetchArgs) => Promise<Response>,
    input: FetchArgs[0],
    init?: FetchArgs[1],
): Promise<Response> {
    if (!Sentry.getClient()) return run(input, init);
    const method = requestMethod(input, init);
    const url = scrubRequestUrl(requestUrl(input));
    const startedAt = performance.now();
    const attributes = { 'http.request.method': method, url };
    return Sentry.startSpan(
        { op: 'http.client', name: `${method} ${url}`, attributes },
        async (span) => {
            try {
                const res = await run(input, init);
                span.setAttribute('http.response.status_code', res.status);
                record('fetch', { method, url, startedAt, status: res.status });
                return res;
            } catch (err) {
                record('fetch', { method, url, startedAt });
                throw err;
            }
        },
    );
}

const xhrRequests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

/** Remember an XHR's method + scrubbed URL at `open` (only when telemetry is ON). */
export function noteXhrOpen(xhr: XMLHttpRequest, method: string, url: string): void {
    if (!Sentry.getClient()) return;
    xhrRequests.set(xhr, { method: method.toUpperCase(), url: scrubRequestUrl(url) });
}

/** At `send`: open a span and record a breadcrumb when the request ends. */
export function traceXhrSend(xhr: XMLHttpRequest): void {
    const req = xhrRequests.get(xhr);
    if (!req || !Sentry.getClient()) return;
    const startedAt = performance.now();
    const span = Sentry.startInactiveSpan({
        op: 'http.client',
        name: `${req.method} ${req.url}`,
        attributes: { 'http.request.method': req.method, url: req.url },
    });
    xhr.addEventListener('loadend', () => {
        const status = xhr.status === 0 ? undefined : xhr.status;
        if (status !== undefined) span.setAttribute('http.response.status_code', status);
        span.end();
        record('xhr', { ...req, startedAt, ...(status === undefined ? {} : { status }) });
    }, { once: true });
}
