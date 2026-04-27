/**
 * Unit tests for getAdminToken() — ROK-1085.
 *
 * Verifies the planned token-on-disk behavior:
 *   1. When scripts/.auth/admin-token.json exists, getAdminToken() reads it
 *      synchronously and does NOT call POST /auth/local.
 *   2. When the file is missing, it falls back to the existing /auth/local
 *      retry path.
 *   3. The module-level cache prevents repeat reads / fetches on subsequent
 *      calls within the same worker process.
 *
 * These tests intentionally fail against the current implementation in
 * scripts/smoke/api-helpers.ts (which always calls fetch), and will pass once
 * the dev wires the file-read path described in planning-artifacts/specs/ROK-1085.md.
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
                issued_at: '2026-04-27T00:00:00.000Z',
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

    it('caches the token in-process — second call hits neither fs nor fetch', async () => {
        mockReadFile.mockResolvedValueOnce(
            JSON.stringify({
                access_token: TOKEN_VALUE,
                issued_at: '2026-04-27T00:00:00.000Z',
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
