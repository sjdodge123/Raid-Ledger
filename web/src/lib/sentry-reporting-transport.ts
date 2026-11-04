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

/** Wraps a transport `send` so every undelivered envelope calls `onFailure`. */
export function reportUndeliveredSends<E, R extends TransportSendResult>(
    send: (envelope: E) => PromiseLike<R>,
    onFailure: () => void,
): (envelope: E) => Promise<R> {
    return async (envelope) => {
        let result: R;
        try {
            result = await send(envelope);
        } catch (err) {
            onFailure();
            throw err;
        }
        if (!isDeliveredSend(result)) onFailure();
        return result;
    };
}
