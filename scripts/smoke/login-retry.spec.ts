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
    MIN_DELAY_MS,
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
    it('honours the server hint verbatim', () => {
        expect(retryDelayMs(0, '30')).toBe(30_000);
    });

    it('prefers the hint over its own backoff', () => {
        expect(retryDelayMs(5, '3')).toBe(3_000);
    });

    it('backs off exponentially without a hint', () => {
        expect(retryDelayMs(0, null)).toBeLessThan(retryDelayMs(1, null));
        expect(retryDelayMs(1, null)).toBeLessThan(retryDelayMs(2, null));
    });

    it('clamps an absurd hint so a bad header cannot hang the run', () => {
        expect(retryDelayMs(0, '99999')).toBe(MAX_DELAY_MS);
        expect(retryDelayMs(99, null)).toBe(MAX_DELAY_MS);
    });

    it('floors a negative/zero hint so it cannot become a hot loop', () => {
        expect(retryDelayMs(0, '-5')).toBe(MIN_DELAY_MS);
        expect(retryDelayMs(0, '0')).toBe(MIN_DELAY_MS);
    });

    it('budgets enough attempts to outlast a rate-limit window', () => {
        expect(MAX_LOGIN_ATTEMPTS).toBeGreaterThanOrEqual(6);
    });
});
