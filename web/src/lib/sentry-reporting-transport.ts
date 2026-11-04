/**
 * Delivery check for the browser Sentry transport (used by
 * `captureMessageVerified`, sentry.ts).
 *
 * A send counts as delivered only when Sentry answered 2xx. Everything else
 * is a failure:
 * - a 4xx/5xx answer (403 bad DSN, 429 rate limit, 413 too large);
 * - no status at all — after a 429 the SDK's transport drops every later
 *   envelope locally (`ratelimit_backoff`, or a full queue) and resolves `{}`
 *   without making a request, which used to read as success;
 * - a rejected send (network error), reported and then rethrown so the SDK
 *   still sees it.
 *
 * Only envelopes that carry an `event` item count. Rate limits are per
 * category, so a replay, transaction or session envelope can be dropped
 * locally (`{}`) while the feedback event itself got a 2xx; counting those
 * would show delivered feedback as failed.
 */

/** The part of a transport response this check reads. */
export interface TransportSendResult {
    statusCode?: number | undefined;
}

/** Whether a transport response means the envelope reached Sentry. */
export function isDeliveredSend(result: TransportSendResult): boolean {
    const status = result.statusCode;
    return status !== undefined && status >= 200 && status < 300;
}

/** The part of an envelope this check reads: each item's header `type`. */
export type EnvelopeItemsView = readonly [
    unknown,
    ReadonlyArray<readonly [{ readonly type?: unknown }, ...unknown[]]>,
];

/** Whether an envelope carries an error/message event (not replay, span, session…). */
export function carriesEvent(envelope: EnvelopeItemsView): boolean {
    return envelope[1].some(([header]) => header.type === 'event');
}

/**
 * Wraps a transport `send` so every undelivered envelope that `counts`
 * calls `onFailure`.
 */
export function reportUndeliveredSends<E, R extends TransportSendResult>(
    send: (envelope: E) => PromiseLike<R>,
    onFailure: () => void,
    counts: (envelope: E) => boolean,
): (envelope: E) => Promise<R> {
    return async (envelope) => {
        let result: R;
        try {
            result = await send(envelope);
        } catch (err) {
            if (counts(envelope)) onFailure();
            throw err;
        }
        if (!isDeliveredSend(result) && counts(envelope)) onFailure();
        return result;
    };
}
