/**
 * ROK-1839 fix round r1 — Codex P2.
 *
 * Lead ruling 2: an unredeemed join token must not survive an abandoned link
 * — and it must certainly not survive the SESSION. Every path that ends one
 * (a rejected refresh, a deactivated account, a logout, an identity change)
 * drops the capture, so the next person on this tab cannot replay it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { fetchCurrentUser } from './use-auth';
import { clearAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { AUTH_METHOD_KEY, USER_CACHE_KEY } from '../lib/api/auth-storage-keys';
import { endDeactivatedSession } from '../lib/api/deactivated-session';
import {
    clearCapturedQueryToken, peekCapturedQueryToken, setCapturedQueryToken,
} from '../lib/query-token-capture';

vi.mock('../lib/api/silent-reauth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/api/silent-reauth')>()),
    attemptSilentReauth: vi.fn(),
}));

const API = 'http://localhost:3000';
const cached = {
    id: 3, username: 'Cached', discordId: '3', displayName: null, avatar: null,
    customAvatarUrl: null, steamId: null, onboardingCompletedAt: null,
};

/** A live, unredeemed join capture sitting in this tab. */
function captureHeld(): void {
    setCapturedQueryToken({ token: 'rok1839.unredeemed.jwt', eventId: '42', intent: 'signup' });
    expect(peekCapturedQueryToken()?.token, 'precondition: a token is held').toBe('rok1839.unredeemed.jwt');
}

function seededClient(): QueryClient {
    localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cached));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(['auth', 'me'], cached);
    return qc;
}

describe('ROK-1839: a session end drops the captured join token', () => {
    beforeEach(() => {
        localStorage.clear();
        window.sessionStorage.clear();
        clearAccessToken();
        clearCapturedQueryToken();
    });

    it('a REJECTED refresh clears it', async () => {
        server.use(http.post(`${API}/auth/refresh`, () => new HttpResponse(null, { status: 401 })));
        captureHeld();
        const qc = seededClient();

        await qc.prefetchQuery({ queryKey: ['auth', 'me'], queryFn: fetchCurrentUser, staleTime: 0 });

        expect(qc.getQueryData(['auth', 'me']), 'precondition: the session ended').toBeNull();
        expect(
            peekCapturedQueryToken(),
            'a rejected refresh ends the session, so the unredeemed token goes with it',
        ).toBeNull();
    });

    it('an INDETERMINATE refresh keeps it (the session did not end)', async () => {
        server.use(http.post(`${API}/auth/refresh`, () => new HttpResponse(null, { status: 503 })));
        captureHeld();
        const qc = seededClient();

        await qc.prefetchQuery({ queryKey: ['auth', 'me'], queryFn: fetchCurrentUser, staleTime: 0 });

        expect(qc.getQueryData(['auth', 'me']), 'precondition: the session survived').toEqual(cached);
        expect(peekCapturedQueryToken()?.token, 'a 503 is not a logout').toBe('rok1839.unredeemed.jwt');
    });

    it('a DEACTIVATED account clears it', () => {
        captureHeld();
        setAccessToken('live.access.jwt');

        endDeactivatedSession(() => { /* stay put: jsdom cannot navigate */ });

        expect(
            peekCapturedQueryToken(),
            'a deactivated session is terminal — nothing of it may be replayable',
        ).toBeNull();
    });

    it('clears the sessionStorage mirror too, not just the in-memory copy', () => {
        captureHeld();

        endDeactivatedSession(() => { /* stay put */ });

        expect(
            window.sessionStorage.getItem('rl.join_token'),
            'a reload of the tab must not resurrect the token',
        ).toBeNull();
    });
});
