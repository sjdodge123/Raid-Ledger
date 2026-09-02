/**
 * Unit tests for the /auth/local back-off policy — ROK-1466.
 *
 * The bug these pin: on the fleet the suite reaches the env over its internal
 * hostname with no Cloudflare hop, so every worker's login hits the API rate
 * limiter at once. Three attempts at a flat 5s/15s with `Retry-After` ignored
 * gave up inside the window — `Auth failed after 3 attempts (rate limited)`.
 */
import { describe, it, expect } from 'vitest';
import {
    MAX_DELAY_MS,
    MAX_LOGIN_ATTEMPTS,
    MAX_TOTAL_WAIT_MS,
    MIN_DELAY_MS,
    nextDelayMs,
    parseRetryAfter,
    retryDelayMs,
} from './login-retry';

describe('parseRetryAfter', () => {
    it('reads delta-seconds', () => {
        expect(parseRetryAfter('30')).toBe(30_000);
    });

    it('reads an HTTP-date', () => {
        const at = new Date(Date.now() + 20_000).toUTCString();
        expect(parseRetryAfter(at)).toBeGreaterThan(18_000);
    });

    it('returns null for an absent or unparsable header', () => {
        expect(parseRetryAfter(null)).toBeNull();
        expect(parseRetryAfter('soon')).toBeNull();
    });
});

describe('retryDelayMs', () => {
    // Contract (ROK-1466, decided after the fleet run): a server `Retry-After`
    // is the only party that knows when the window reopens, so it is honoured
    // VERBATIM here. MAX_DELAY_MS bounds our OWN guesswork only. Affordability
    // is not this function's business — nextDelayMs owns the total budget.
    it('honours a server hint verbatim', () => {
        expect(retryDelayMs(0, '30')).toBe(30_000);
        expect(retryDelayMs(0, '10')).toBe(10_000);
    });

    it('honours a hint even when it exceeds our own backoff cap', () => {
        expect(retryDelayMs(0, '99999')).toBe(99_999_000);
    });

    it('prefers the hint over its own backoff', () => {
        expect(retryDelayMs(5, '3')).toBe(3_000);
    });

    it('backs off exponentially without a hint', () => {
        expect(retryDelayMs(0, null)).toBeLessThan(retryDelayMs(1, null));
        expect(retryDelayMs(1, null)).toBeLessThan(retryDelayMs(2, null));
    });

    it('caps its own backoff — but only its own', () => {
        expect(retryDelayMs(99, null)).toBe(MAX_DELAY_MS);
    });

    it('floors a negative/zero hint so it cannot become a hot loop', () => {
        expect(retryDelayMs(0, '-5')).toBe(MIN_DELAY_MS);
        expect(retryDelayMs(0, '0')).toBe(MIN_DELAY_MS);
    });
});

describe('nextDelayMs', () => {
    // loginViaApi runs INSIDE a Playwright test (30s CI / 60s local timeout).
    // A retry budget longer than that makes the give-up message unreachable —
    // the test dies on a timeout that names nothing.
    it('fits inside a Playwright test timeout', () => {
        expect(MAX_TOTAL_WAIT_MS).toBeLessThanOrEqual(25_000);
    });

    it('honours a hint that fits the remaining budget, verbatim', () => {
        expect(nextDelayMs(0, '20', 0)).toBe(20_000);
        expect(nextDelayMs(0, '5', 10_000)).toBe(5_000);
    });

    // Clamping an unaffordable hint would retry BEFORE the window reopens —
    // guaranteed to 429 again, and it hammers the limiter early. Refusing lets
    // the caller throw a diagnostic naming the wait the server asked for.
    it('gives up when the hint exceeds the remaining budget', () => {
        expect(nextDelayMs(0, '600', 0)).toBeNull();
        expect(nextDelayMs(0, '20', 10_000)).toBeNull();
    });

    it('gives up once the budget is spent', () => {
        expect(nextDelayMs(0, null, MAX_TOTAL_WAIT_MS)).toBeNull();
        expect(nextDelayMs(0, '5', MAX_TOTAL_WAIT_MS + 1)).toBeNull();
    });

    it('gives up rather than sleep a stub of the remaining budget', () => {
        expect(nextDelayMs(0, null, MAX_TOTAL_WAIT_MS - 500)).toBeNull();
    });

    it('sleeps its own backoff while it fits', () => {
        expect(nextDelayMs(0, null, 0)).toBe(retryDelayMs(0, null));
    });
});
