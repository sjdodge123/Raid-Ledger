/**
 * Unit tests for getAdminToken() — ROK-1085.
 *
 * Verifies the token-on-disk behavior shipped in PR #667:
 *   1. When scripts/.auth/admin-token.json exists, getAdminToken() reads it
 *      synchronously and does NOT call POST /auth/local.
 *   2. When the file is missing, it falls back to the existing /auth/local
 *      retry path.
 *   3. The module-level cache prevents repeat reads / fetches on subsequent
 *      calls within the same worker process.
 *   4. ROK-1149: tokens whose `issued_at` is older than the 50-min TTL are
 *      treated as missing and fall back to live login.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fs/promises mocks — declared at module-eval time (vi.mock is hoisted).
const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
    default: {
        readFile: (...args: unknown[]) => mockReadFile(...args),
    },
}));
// Also mock the un-prefixed form in case the dev imports from 'fs/promises'.
vi.mock('fs/promises', () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
    default: {
        readFile: (...args: unknown[]) => mockReadFile(...args),
    },
}));

const TOKEN_VALUE = 'jwt-from-disk-aaa.bbb.ccc';
const FALLBACK_TOKEN = 'jwt-from-fallback-xxx.yyy.zzz';

function makeEnoent(): NodeJS.ErrnoException {
    const err = new Error(
        "ENOENT: no such file or directory, open 'admin-token.json'",
    ) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return err;
}

describe('getAdminToken (ROK-1085)', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        mockReadFile.mockReset();
        fetchSpy = vi.fn(async () =>
            new Response(JSON.stringify({ access_token: FALLBACK_TOKEN }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reads admin-token.json and returns access_token without calling fetch', async () => {
        mockReadFile.mockResolvedValueOnce(
            JSON.stringify({
                access_token: TOKEN_VALUE,
                issued_at: new Date().toISOString(),
            }),
        );

        const { getAdminToken } = await import('./api-helpers');
        const token = await getAdminToken();

        expect(token).toBe(TOKEN_VALUE);
        expect(mockReadFile).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('falls back to POST /auth/local when admin-token.json is missing', async () => {
        mockReadFile.mockRejectedValueOnce(makeEnoent());

        const { getAdminToken } = await import('./api-helpers');
        const token = await getAdminToken();

        // The implementation MUST attempt a file read first — otherwise the
        // happy-path optimization (test 1) cannot exist. With the planned
        // implementation, mockReadFile is called once and rejects with ENOENT,
        // then fetch is called as the fallback.
        expect(mockReadFile).toHaveBeenCalledTimes(1);
        expect(token).toBe(FALLBACK_TOKEN);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(String(url)).toContain('/auth/local');
        expect(init?.method).toBe('POST');
    });

    it('falls back to POST /auth/local when on-disk token is older than 50 min (ROK-1149)', async () => {
        const stale = new Date(Date.now() - 51 * 60 * 1000).toISOString();
        mockReadFile.mockResolvedValueOnce(
            JSON.stringify({ access_token: TOKEN_VALUE, issued_at: stale }),
        );

        const { getAdminToken } = await import('./api-helpers');
        const token = await getAdminToken();

        expect(mockReadFile).toHaveBeenCalledTimes(1);
        expect(token).toBe(FALLBACK_TOKEN);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('caches the token in-process — second call hits neither fs nor fetch', async () => {
        mockReadFile.mockResolvedValueOnce(
            JSON.stringify({
                access_token: TOKEN_VALUE,
                issued_at: new Date().toISOString(),
            }),
        );

        const { getAdminToken } = await import('./api-helpers');
        const first = await getAdminToken();
        const second = await getAdminToken();

        expect(first).toBe(TOKEN_VALUE);
        expect(second).toBe(TOKEN_VALUE);
        expect(mockReadFile).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// createLineupOrRetry (ROK-1167)
// ---------------------------------------------------------------------------

function jsonRes(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function textRes(body: string, status: number) {
    return new Response(body, {
        status,
        headers: { 'Content-Type': 'text/plain' },
    });
}

describe('createLineupOrRetry (ROK-1167)', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns id when first POST /lineups responds 201', async () => {
        fetchSpy.mockResolvedValueOnce(jsonRes({ id: 42 }, 201));

        const { createLineupOrRetry } = await import('./api-helpers');
        const result = await createLineupOrRetry(
            'token-abc',
            { title: 'smoke-w0-foo Smoke Lineup' },
            'smoke-w0-foo-',
            { delayMs: 0 },
        );

        expect(result).toEqual({ id: 42 });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(String(url)).toContain('/lineups');
        expect(init?.method).toBe('POST');
    });

    it('on 409 → calls /admin/test/reset-lineups with prefix, retries, returns id', async () => {
        fetchSpy.mockResolvedValueOnce(textRes('conflict', 409));
        fetchSpy.mockResolvedValueOnce(jsonRes({ ok: true }, 200));
        fetchSpy.mockResolvedValueOnce(jsonRes({ id: 7 }, 201));

        const { createLineupOrRetry } = await import('./api-helpers');
        const result = await createLineupOrRetry(
            'token-abc',
            { title: 'smoke-w1-bar Smoke Lineup' },
            'smoke-w1-bar-',
            { delayMs: 0 },
        );

        expect(result).toEqual({ id: 7 });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        const [resetUrl, resetInit] = fetchSpy.mock.calls[1] as [
            string,
            RequestInit,
        ];
        expect(String(resetUrl)).toContain('/admin/test/reset-lineups');
        expect(resetInit?.method).toBe('POST');
        expect(JSON.parse(String(resetInit?.body))).toEqual({
            titlePrefix: 'smoke-w1-bar-',
        });
    });

    it('throws after exhausting attempts with prefix + last status + body in the message', async () => {
        for (let i = 0; i < 10; i++) {
            fetchSpy.mockResolvedValueOnce(textRes('still conflict', 409));
        }

        const { createLineupOrRetry } = await import('./api-helpers');
        const promise = createLineupOrRetry(
            'token-abc',
            { title: 'smoke-w2-baz Smoke Lineup' },
            'smoke-w2-baz-',
            { attempts: 3, delayMs: 0 },
        );

        await expect(promise).rejects.toThrow(/smoke-w2-baz-/);
        await expect(promise).rejects.toThrow(/409/);
        await expect(promise).rejects.toThrow(/still conflict/);

        // 3 attempts × (POST /lineups + reset) = 6 fetch calls.
        expect(fetchSpy).toHaveBeenCalledTimes(6);
    });
});
