/**
 * ROK-1845 — `/auth/success` echoes the invite code back into an in-app
 * navigate. A hostile code must stay inside the `/i/:code` route.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Routes, Route, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import type { User } from '../hooks/use-auth';
import { renderWithProviders } from '../test/render-helpers';
import { server } from '../test/mocks/server';
import { AuthSuccessPage } from './auth-success-page';

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ login: vi.fn().mockResolvedValue(auth.user) }) }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function makeUser(onboarded: boolean): User {
    return {
        id: 42, discordId: 'd-42', username: 'visitor', displayName: null, avatar: null,
        customAvatarUrl: null, role: 'member', steamId: null,
        onboardingCompletedAt: onboarded ? '2026-01-01T00:00:00.000Z' : null,
    } as User;
}

function LocationProbe(): JSX.Element {
    const { pathname, search } = useLocation();
    return <output data-testid="location">{pathname + search}</output>;
}

function renderCallback(invite: string) {
    renderWithProviders(
        <>
            <LocationProbe />
            <Routes>
                <Route path="/auth/success" element={<AuthSuccessPage />} />
                <Route path="*" element={<p>Elsewhere</p>} />
            </Routes>
        </>,
        { initialEntries: [`/auth/success?code=c1&invite=${encodeURIComponent(invite)}`] },
    );
}

const location = () => screen.getByTestId('location');

describe('AuthSuccessPage — invite code encoding (ROK-1845)', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        vi.clearAllMocks();
        server.use(http.post('http://localhost:3000/auth/exchange-code', () => HttpResponse.json({ access_token: 'jwt' })));
    });

    it.each([false, true])('keeps a hostile invite inside /i/ (onboarded=%s)', async (onboarded) => {
        auth.user = makeUser(onboarded);
        renderCallback('../admin/settings');
        await waitFor(() => expect(location()).toHaveTextContent('/i/..%2Fadmin%2Fsettings?claim=1'));
    });

    it('a bare ".." invite skips the invite redirect', async () => {
        auth.user = makeUser(false);
        renderCallback('..');
        await waitFor(() => expect(location()).toHaveTextContent('/onboarding'));
    });

    it('a valid invite still resumes the claim', async () => {
        auth.user = makeUser(true);
        renderCallback('abc12345');
        await waitFor(() => expect(location()).toHaveTextContent('/i/abc12345?claim=1'));
    });
});
