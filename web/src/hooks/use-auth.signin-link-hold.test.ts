/**
 * ROK-2283 (Codex P2): while `/signin-link` holds an unspent token, a rejected
 * refresh must NOT start the silent Discord OAuth redirect — the token lives
 * only in memory and the hop would lose it before Continue. Covers both the
 * App.tsx boot prefetch and the page's own useAuth (same query function).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { fetchCurrentUser } from './use-auth';
import { attemptSilentReauth } from '../lib/api/silent-reauth';
import { clearAccessToken } from '../lib/api/access-token-store';
import { AUTH_METHOD_KEY } from '../lib/api/auth-storage-keys';

vi.mock('../lib/api/silent-reauth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/api/silent-reauth')>()),
    attemptSilentReauth: vi.fn(),
}));
const held = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../lib/magic-link-capture', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/magic-link-capture')>()),
    peekCapturedSigninLinkToken: () => held.token,
}));

const API = 'http://localhost:3000';

/** A returning Discord user whose refresh cookie has expired. */
async function bootWithExpiredRefresh(): Promise<unknown> {
    localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    server.use(http.post(`${API}/auth/refresh`, () => new HttpResponse(null, { status: 401 })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await qc.prefetchQuery({ queryKey: ['auth', 'me'], queryFn: fetchCurrentUser, staleTime: 0 });
    return qc.getQueryData(['auth', 'me']);
}

describe('ROK-2283: a held /signin-link token suppresses silent re-auth', () => {
    beforeEach(() => {
        localStorage.clear();
        clearAccessToken();
        held.token = null;
        vi.mocked(attemptSilentReauth).mockClear();
    });

    it('settles signed-out without redirecting while a sign-in link is held', async () => {
        held.token = 'held.signin.token';
        expect(await bootWithExpiredRefresh()).toBeNull();
        expect(attemptSilentReauth, 'the silent OAuth hop would drop the held link').not.toHaveBeenCalled();
    });

    it('still attempts the silent re-auth when no sign-in link is held', async () => {
        expect(await bootWithExpiredRefresh()).toBeNull();
        expect(attemptSilentReauth).toHaveBeenCalledTimes(1);
    });
});
