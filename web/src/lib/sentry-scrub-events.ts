/**
 * ROK-1366: scrub `token=` from the Sentry payloads that do not pass through
 * beforeSend / beforeBreadcrumb.
 *
 * The magic-link fragment is stripped from the address bar before Sentry
 * initialises, but the navigation PerformanceEntry keeps the ORIGINAL URL,
 * fragment included. browserTracing names the pageload's browser.request /
 * browser.response / browser.<timing> spans after that entry, and Replay
 * records it as a `navigation.navigate` performanceSpan. Replay also lists
 * every history push (e.g. `/join?...&token=`) in the replay_event `urls`.
 */
import { scrubTokenFromUrl } from './sentry-scrub';

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
    return typeof value === 'object' && value !== null;
}

/** Scrub every direct string value of a record in place. */
function scrubStringValues(record: unknown): void {
    if (!isRecord(record)) return;
    for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'string') record[key] = scrubTokenFromUrl(value);
    }
}

interface ScrubbableTransaction {
    request?: unknown;
    spans?: unknown[];
    contexts?: { trace?: { data?: unknown } };
}

/** beforeSendTransaction: name, request, root-span data, every child span. */
export function scrubTransactionEvent<T extends ScrubbableTransaction>(event: T): T {
    scrubStringValues(event);
    scrubStringValues(event.request);
    scrubStringValues(event.contexts?.trace?.data);
    for (const span of event.spans ?? []) {
        scrubStringValues(span);
        if (isRecord(span)) scrubStringValues(span.data);
    }
    return event;
}

/**
 * Replay beforeAddRecordingEvent: a custom (type-5) event's payload
 * (performanceSpan / breadcrumb description, message, data). Replay passes
 * only custom events to this hook, so the rrweb Meta `href` never reaches it.
 */
export function scrubRecordingEvent<T>(event: T): T {
    const data = isRecord(event) ? event.data : undefined;
    scrubStringValues(data);
    const payload = isRecord(data) ? data.payload : undefined;
    scrubStringValues(payload);
    if (isRecord(payload)) scrubStringValues(payload.data);
    return event;
}

/** Event processor: the replay_event `urls` list (history pushes). */
export function scrubReplayEventUrls<T>(event: T): T {
    if (!isRecord(event)) return event;
    const record: Rec = event;
    if (Array.isArray(record.urls)) {
        record.urls = record.urls.map((url: unknown) =>
            typeof url === 'string' ? scrubTokenFromUrl(url) : url,
        );
    }
    return event;
}
