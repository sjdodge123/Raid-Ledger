/**
 * ROK-1845 — the invite and character helpers put a decoded route param into
 * the API path. Whatever it holds, the request stays on the intended route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fetch-api', () => ({ fetchApi: vi.fn() }));

import { fetchApi } from './fetch-api';
import { resolveInviteCode, claimInviteCode } from './discord-api';
import { getCharacterDetail } from './characters-api';

const mockFetchApi = vi.mocked(fetchApi);
const HOSTILE = '..?claim=1#x';
const ENCODED = '..%3Fclaim%3D1%23x';
/** nginx decodes %2F and collapses `..` before proxying, so these send nothing. */
const TRAVERSAL = '../../admin/settings';

/** The path the request resolves to once the browser normalises it. */
function resolvedPath(): string {
    const endpoint = mockFetchApi.mock.calls[0]?.[0];
    if (typeof endpoint !== 'string') throw new Error('fetchApi was not called with a path');
    return new URL(`http://api.test${endpoint}`).pathname;
}

describe('route-param path encoding (ROK-1845)', () => {
    beforeEach(() => {
        mockFetchApi.mockReset();
        mockFetchApi.mockResolvedValue({});
    });

    it('resolveInviteCode keeps a hostile code under /invite/', async () => {
        await resolveInviteCode(HOSTILE);
        expect(resolvedPath()).toBe(`/invite/${ENCODED}`);
    });

    it('claimInviteCode keeps a hostile code under /invite/:code/claim', async () => {
        await claimInviteCode(HOSTILE);
        expect(resolvedPath()).toBe(`/invite/${ENCODED}/claim`);
    });

    it('getCharacterDetail keeps a hostile id under /characters/', async () => {
        await getCharacterDetail(HOSTILE);
        expect(resolvedPath()).toBe(`/characters/${ENCODED}`);
    });

    it('a bare ".." code sends no request at all', async () => {
        await expect(claimInviteCode('..')).rejects.toThrow(/path segment/i);
        await expect(getCharacterDetail('..')).rejects.toThrow(/path segment/i);
        expect(mockFetchApi).not.toHaveBeenCalled();
    });

    it.each([TRAVERSAL, '..\\..\\admin'])('a code holding a path separator sends no request (%j)', async (value) => {
        await expect(resolveInviteCode(value)).rejects.toThrow(/path segment/i);
        await expect(claimInviteCode(value)).rejects.toThrow(/path segment/i);
        await expect(getCharacterDetail(value)).rejects.toThrow(/path segment/i);
        expect(mockFetchApi).not.toHaveBeenCalled();
    });

    it('a valid code still hits the plain route', async () => {
        await resolveInviteCode('abc12345');
        expect(mockFetchApi).toHaveBeenCalledWith('/invite/abc12345');
    });
});
