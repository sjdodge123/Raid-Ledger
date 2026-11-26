/**
 * ROK-2370: a finished Discord OAuth sign-in writes both browser markers —
 * the "Last used" card (`rl_last_signin`, method 'discord') and the 14-day
 * touch-device silent re-auth timestamp (`rl_discord_oauth_at`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { LAST_SIGNIN_KEY } from '../lib/last-signin';
import { DISCORD_OAUTH_AT_KEY } from '../lib/api/auth-storage-keys';
import { AuthSuccessPage } from './auth-success-page';

const login = vi.hoisted(() => vi.fn());
vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ login }) }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../components/auth', () => ({ consumeAuthRedirect: () => null }));

describe('AuthSuccessPage — ROK-2370 sign-in markers', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.clearAllMocks();
        login.mockResolvedValue({
            id: 5, username: 'returning', displayName: 'Returning Raider', avatar: null, customAvatarUrl: null,
            discordId: 'd-5', role: 'member', onboardingCompletedAt: '2026-01-01T00:00:00Z',
        });
        server.use(http.post('http://localhost:3000/auth/exchange-code', () =>
            HttpResponse.json({ access_token: 'header.payload.sig' })));
    });

    it('records the last-used marker as Discord with the member name', async () => {
        renderWithProviders(<AuthSuccessPage />, { initialEntries: ['/auth/success?code=rok2370'] });

        await waitFor(() => expect(localStorage.getItem(LAST_SIGNIN_KEY)).not.toBeNull());
        const marker = JSON.parse(localStorage.getItem(LAST_SIGNIN_KEY) ?? '{}') as Record<string, unknown>;
        expect(marker.method).toBe('discord');
        expect(marker.name).toBe('Returning Raider');
    });

    it('stamps the Discord OAuth timestamp that arms the touch-device silent bounce', async () => {
        const before = Date.now();
        renderWithProviders(<AuthSuccessPage />, { initialEntries: ['/auth/success?code=rok2370b'] });

        await waitFor(() => expect(localStorage.getItem(LAST_SIGNIN_KEY)).not.toBeNull());
        expect(Number(localStorage.getItem(DISCORD_OAUTH_AT_KEY)), 'rl_discord_oauth_at must be now')
            .toBeGreaterThanOrEqual(before);
    });
});
