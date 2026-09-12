/**
 * Unit tests for the smoke suite's transport-only fetch retry.
 *
 * The contract has two halves and BOTH matter:
 *   1. a dropped connect (undici `TypeError: fetch failed`, ConnectTimeoutError,
 *      ECONNRESET, UND_ERR_*) is retried — that is the phantom per-spec red
 *      seen through the Cloudflare edge in front of the fleet's slot-N envs
 *      (ROK-1309/1310: lfg-group-page:255, lineup-abort:166);
 *   2. an HTTP RESPONSE of ANY status is never retried — a 500 is the server
 *      answering, and retrying it would mask real product failures and
 *      double-apply writes.
 *
 * Revert-proofing: each retry assertion pins the observed CALL COUNT, so
 * removing the retry (returning a bare `fetch`) fails them on the count, not
 * on a timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, isTransportError, MAX_FETCH_ATTEMPTS } from './fetch-retry';

/** undici's real shape: a TypeError whose `cause` carries the code. */
function transportError(code = 'UND_ERR_CONNECT_TIMEOUT'): TypeError {
    const cause = Object.assign(new Error('Connect Timeout Error'), {
        code,
        name: 'ConnectTimeoutError',
    });
    return Object.assign(new TypeError('fetch failed'), { cause });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('fetchWithRetry', () => {
    it('retries a transport error twice, then returns the single success', async () => {
        fetchSpy = vi
            .fn()
            .mockRejectedValueOnce(transportError())
            .mockRejectedValueOnce(transportError('ECONNRESET'))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchSpy);

        const res = await fetchWithRetry('http://api.test/thing');

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ ok: true });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry an HTTP 500 — the server answered', async () => {
        fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ message: 'boom' }, 500));
        vi.stubGlobal('fetch', fetchSpy);

        const res = await fetchWithRetry('http://api.test/thing');

        expect(res.status).toBe(500);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it.each([400, 401, 409, 429])('does NOT retry an HTTP %i', async (status) => {
        fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}, status));
        vi.stubGlobal('fetch', fetchSpy);

        const res = await fetchWithRetry('http://api.test/thing');

        expect(res.status).toBe(status);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('rethrows the ORIGINAL error after exhausting its attempts', async () => {
        const err = transportError();
        fetchSpy = vi.fn().mockRejectedValue(err);
        vi.stubGlobal('fetch', fetchSpy);

        await expect(fetchWithRetry('http://api.test/thing')).rejects.toBe(err);
        expect(fetchSpy).toHaveBeenCalledTimes(MAX_FETCH_ATTEMPTS);
    });

    it('does NOT retry a non-transport throw (a programming error)', async () => {
        const err = new TypeError('Failed to parse URL from /relative');
        fetchSpy = vi.fn().mockRejectedValue(err);
        vi.stubGlobal('fetch', fetchSpy);

        await expect(fetchWithRetry('/relative')).rejects.toBe(err);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

describe('isTransportError', () => {
    it('recognises undici transport faults, directly or via cause', () => {
        expect(isTransportError(transportError())).toBe(true);
        expect(isTransportError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
        expect(isTransportError(Object.assign(new Error('x'), { code: 'UND_ERR_SOCKET' }))).toBe(
            true,
        );
        expect(isTransportError(new Error('socket hang up'))).toBe(true);
    });

    it('does not classify ordinary errors as transport faults', () => {
        expect(isTransportError(new Error('Auth failed: 401'))).toBe(false);
        expect(isTransportError(new TypeError('x.map is not a function'))).toBe(false);
        expect(isTransportError(null)).toBe(false);
    });
});

describe('the api helpers use it', () => {
    it('apiGet survives one dropped connect and returns the parsed body', async () => {
        vi.resetModules();
        fetchSpy = vi
            .fn()
            .mockRejectedValueOnce(transportError())
            .mockResolvedValueOnce(jsonResponse({ id: 7 }));
        vi.stubGlobal('fetch', fetchSpy);

        const { apiGet } = await import('./api-helpers');

        await expect(apiGet('tok', '/lineups/7')).resolves.toEqual({ id: 7 });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
});
