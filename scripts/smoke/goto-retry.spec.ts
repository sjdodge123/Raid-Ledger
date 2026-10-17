/**
 * Unit tests for the smoke suite's navigation retry (TDB:1040).
 *
 * The contract has two halves and BOTH matter:
 *   1. a Chromium transport error (`net::ERR_CONNECTION_RESET`,
 *      `net::ERR_TIMED_OUT`, ...) gets exactly ONE more attempt — the fleet
 *      reaches its envs through the Cloudflare edge, and a single dropped
 *      connect there used to fail whichever spec happened to be navigating;
 *   2. a Playwright navigation TIMEOUT, an aborted navigation and any HTTP
 *      response are never retried — retrying a genuinely hung page would
 *      double every navigation's budget and turn a slow failure into a
 *      test-level timeout that names nothing.
 *
 * Revert-proofing: the retry assertions pin the observed CALL COUNT, so
 * removing the retry fails them on the count, not on a timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gotoWithRetry, isNavigationTransportError } from './goto-retry';

/** Playwright's real shape for a transport failure during page.goto. */
function netError(code: string): Error {
    return new Error(`page.goto: net::${code} at https://slot-1.gamernight.net/events\nCall log: ...`);
}

/** Playwright's real shape for a navigation timeout. */
function timeoutError(): Error {
    const err = new Error('page.goto: Timeout 30000ms exceeded.');
    err.name = 'TimeoutError';
    return err;
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('isNavigationTransportError', () => {
    it.each([
        'ERR_CONNECTION_RESET',
        'ERR_CONNECTION_REFUSED',
        'ERR_CONNECTION_CLOSED',
        'ERR_TIMED_OUT',
        'ERR_NAME_NOT_RESOLVED',
        'ERR_NETWORK_CHANGED',
    ])('treats net::%s as a retryable transport error', (code) => {
        expect(isNavigationTransportError(netError(code))).toBe(true);
    });

    it('never retries a Playwright navigation timeout', () => {
        expect(isNavigationTransportError(timeoutError())).toBe(false);
    });

    it('never retries a TimeoutError even if its log mentions net::ERR_', () => {
        const err = netError('ERR_TIMED_OUT');
        err.name = 'TimeoutError';
        expect(isNavigationTransportError(err)).toBe(false);
    });

    it('never retries net::ERR_ABORTED (a navigation superseded by another)', () => {
        expect(isNavigationTransportError(netError('ERR_ABORTED'))).toBe(false);
    });

    it('never retries a non-navigation error or a non-error value', () => {
        expect(isNavigationTransportError(new Error('Target page, context or browser has been closed'))).toBe(false);
        expect(isNavigationTransportError('net::ERR_CONNECTION_RESET')).toBe(false);
        expect(isNavigationTransportError(null)).toBe(false);
    });
});

describe('gotoWithRetry', () => {
    it('retries one net::ERR_* failure and returns the second attempt', async () => {
        const response = { status: () => 200 };
        const goto = vi
            .fn()
            .mockRejectedValueOnce(netError('ERR_CONNECTION_RESET'))
            .mockResolvedValueOnce(response);

        await expect(gotoWithRetry(goto, '/events', { waitUntil: 'domcontentloaded' })).resolves.toBe(response);
        expect(goto).toHaveBeenCalledTimes(2);
        expect(goto).toHaveBeenNthCalledWith(2, '/events', { waitUntil: 'domcontentloaded' });
    });

    it('is bounded to ONE extra attempt — a second net::ERR_* is rethrown unchanged', async () => {
        const second = netError('ERR_TIMED_OUT');
        const goto = vi.fn().mockRejectedValueOnce(netError('ERR_CONNECTION_RESET')).mockRejectedValueOnce(second);

        await expect(gotoWithRetry(goto, '/events')).rejects.toBe(second);
        expect(goto).toHaveBeenCalledTimes(2);
    });

    it('does not retry a navigation timeout', async () => {
        const err = timeoutError();
        const goto = vi.fn().mockRejectedValueOnce(err);

        await expect(gotoWithRetry(goto, '/events')).rejects.toBe(err);
        expect(goto).toHaveBeenCalledTimes(1);
    });

    it('returns an HTTP error response as-is without retrying', async () => {
        const response = { status: () => 502 };
        const goto = vi.fn().mockResolvedValueOnce(response);

        await expect(gotoWithRetry(goto, '/events')).resolves.toBe(response);
        expect(goto).toHaveBeenCalledTimes(1);
    });
});
