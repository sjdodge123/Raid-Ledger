/**
 * ROK-1754 review m1: an identity change (impersonation start/exit, a sibling
 * tab's epoch bump) fences off any refresh POSTed under the old identity.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { bumpRefreshGeneration, freshRefresh, refreshWithOutcome } from './refresh-client';
import { clearAccessToken, getAccessToken, setAccessToken } from './access-token-store';
import { AUTH_METHOD_KEY } from './auth-storage-keys';

const API = 'http://localhost:3000';

/** Refresh POSTs answer in order; the first one is held until `release()`. */
function gatedRefresh(tokens: string[]): { release: () => void; posts: () => number } {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let posts = 0;
    server.use(http.post(`${API}/auth/refresh`, async () => {
        const token = tokens[posts];
        posts += 1;
        if (posts === 1) await gate;
        return HttpResponse.json({ access_token: token });
    }));
    return { release, posts: () => posts };
}

describe('ROK-1754 m1: identity generation fence', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        clearAccessToken();
    });

    it('a refresh POSTed before an impersonation start does not overwrite its token', async () => {
        const { release } = gatedRefresh(['admin.jwt']);
        const stale = refreshWithOutcome();
        bumpRefreshGeneration();
        setAccessToken('impersonation.jwt');
        release();
        await expect(stale).resolves.toEqual({ kind: 'indeterminate' });
        expect(getAccessToken(), 'the stale admin refresh must not replace the new identity').toBe('impersonation.jwt');
    });

    it('freshRefresh waits out an in-flight POST and never joins it', async () => {
        const { release, posts } = gatedRefresh(['impersonation.jwt', 'admin.jwt']);
        void refreshWithOutcome();
        const fresh = freshRefresh();
        release();
        await expect(fresh).resolves.toEqual({ kind: 'ok', token: 'admin.jwt' });
        expect(posts(), 'a second POST, sent after the identity change').toBe(2);
        expect(getAccessToken()).toBe('admin.jwt');
    });
});
