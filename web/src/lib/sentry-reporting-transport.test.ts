/**
 * The feedback form's "sent" confirmation trusts this check
 * (captureMessageVerified). After a 429 the Sentry SDK drops later envelopes
 * locally and resolves `{}` with no status — that must count as undelivered,
 * not as success (TECH-DEBT-BACKLOG, sentry.ts false success).
 */
import { describe, it, expect, vi } from 'vitest';
import {
    carriesEvent,
    isDeliveredSend,
    reportUndeliveredSends,
    type EnvelopeItemsView,
    type TransportSendResult,
} from './sentry-reporting-transport';

function envelopeOf(...types: string[]): EnvelopeItemsView {
    return [{}, types.map((type) => [{ type }, {}] as const)];
}
const EVENT = envelopeOf('event');

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
        const send = reportUndeliveredSends(sendReturning({ statusCode: 429 }, {}), onFailure, carriesEvent);
        await send(EVENT);
        expect(onFailure, 'the 429 answer is a failure').toHaveBeenCalledTimes(1);
        await expect(send(EVENT)).resolves.toEqual({});
        expect(onFailure, 'the rate-limited drop with no status is a failure').toHaveBeenCalledTimes(2);
    });

    it('does not report a delivered (2xx) send', async () => {
        const onFailure = vi.fn();
        const send = reportUndeliveredSends(sendReturning({ statusCode: 200 }), onFailure, carriesEvent);
        await expect(send(EVENT)).resolves.toEqual({ statusCode: 200 });
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('reports a rejected send and still rethrows it to the SDK', async () => {
        const onFailure = vi.fn();
        const boom = new Error('network down');
        const send = reportUndeliveredSends(() => Promise.reject(boom), onFailure, carriesEvent);
        await expect(send(EVENT)).rejects.toBe(boom);
        expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('ignores a rate-limited replay/transaction/session drop (category limits)', async () => {
        const onFailure = vi.fn();
        const send = reportUndeliveredSends(sendReturning({}, {}, {}), onFailure, carriesEvent);
        await send(envelopeOf('replay_event', 'replay_recording'));
        await send(envelopeOf('transaction'));
        await send(envelopeOf('session'));
        expect(onFailure, 'only an event envelope can fail the feedback check').not.toHaveBeenCalled();
    });
});

describe('carriesEvent', () => {
    it('is true only when an item is an event', () => {
        expect(carriesEvent(envelopeOf('event', 'attachment'))).toBe(true);
        expect(carriesEvent(envelopeOf('transaction'))).toBe(false);
        expect(carriesEvent(envelopeOf())).toBe(false);
    });
});
