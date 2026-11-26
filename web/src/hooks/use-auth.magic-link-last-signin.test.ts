/**
 * ROK-2370: a magic link from the Discord bot that adopts a session makes the
 * first /auth/me after it record the "Last used" marker as the Discord app
 * code method. A plain /auth/me (no redeem) records nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { startMagicLinkRedeem } from '../lib/magic-link-redeem';
import { LAST_SIGNIN_KEY } from '../lib/last-signin';
import { clearAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { fetchCurrentUser } from './use-auth';

const API = 'http://localhost:3000';
const MAGIC = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjcsIm1hZ2ljTGluayI6dHJ1ZX0.sig';
const ME = {
    id: 7, username: 'member7', displayName: 'Member Seven', avatar: null, customAvatarUrl: null,
    discordId: 'd-7', role: 'member',
};

function markerMethod(): unknown {
    const raw = localStorage.getItem(LAST_SIGNIN_KEY);
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>).method;
}

describe('fetchCurrentUser — last-used marker after a magic-link redeem (ROK-2370)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        clearAccessToken();
        server.use(
            http.post(`${API}/auth/redeem-magic-link`, () => HttpResponse.json({ access_token: 'magic.session' })),
            http.get(`${API}/auth/me`, () => HttpResponse.json(ME)),
        );
    });

    it('records discord-app-code on the first /auth/me after the redeem adopted a session', async () => {
        await startMagicLinkRedeem(MAGIC);
        await fetchCurrentUser();

        expect(markerMethod(), 'magic-link sign-in must write the last-used marker').toBe('discord-app-code');
    });

    it('records nothing on an ordinary /auth/me with no redeem', async () => {
        setAccessToken('already.signed.in');
        await fetchCurrentUser();

        expect(markerMethod()).toBeNull();
    });
});
