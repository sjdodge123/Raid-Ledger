/**
 * The feedback form's "sent" confirmation trusts this check
 * (captureMessageVerified). After a 429 the Sentry SDK drops later envelopes
 * locally and resolves `{}` with no status — that must count as undelivered,
 * not as success (TECH-DEBT-BACKLOG, sentry.ts false success).
 */
import { describe, it, expect, vi } from 'vitest';
import {
    isDeliveredSend,
    reportUndeliveredSends,
    type TransportSendResult,
} from './sentry-reporting-transport';

function sendReturning(...results: TransportSendResult[]) {
    const queue = [...results];
    return vi.fn(() => Promise.resolve(queue.shift() ?? {}));
}

describe('isDeliveredSend', () => {
    it('accepts only a 2xx answer', () => {
        expect(isDeliveredSend({ statusCode: 200 })).toBe(true);
        expect(isDeliveredSend({ statusCode: 204 })).toBe(true);
        expect(isDeliveredSend({ statusCode: 429 }), '429 rate limit').toBe(false);
        expect(isDeliveredSend({ statusCode: 403 }), '403 bad DSN').toBe(false);
        expect(isDeliveredSend({}), 'status-less local drop').toBe(false);
    });
});

describe('reportUndeliveredSends', () => {
    it('reports both the 429 and the status-less drop that follows it', async () => {
        const onFailure = vi.fn();
        const send = reportUndeliveredSends(sendReturning({ statusCode: 429 }, {}), onFailure);
        await send('first');
        expect(onFailure, 'the 429 answer is a failure').toHaveBeenCalledTimes(1);
        await expect(send('second')).resolves.toEqual({});
        expect(onFailure, 'the rate-limited drop with no status is a failure').toHaveBeenCalledTimes(2);
    });

    it('does not report a delivered (2xx) send', async () => {
        const onFailure = vi.fn();
        const send = reportUndeliveredSends(sendReturning({ statusCode: 200 }), onFailure);
        await expect(send('ok')).resolves.toEqual({ statusCode: 200 });
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('reports a rejected send and still rethrows it to the SDK', async () => {
        const onFailure = vi.fn();
        const boom = new Error('network down');
        const send = reportUndeliveredSends(() => Promise.reject(boom), onFailure);
        await expect(send('x')).rejects.toBe(boom);
        expect(onFailure).toHaveBeenCalledTimes(1);
    });
});
