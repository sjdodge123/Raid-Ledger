/**
 * ROK-1750 (D5) — after Discord sign-in, a pending private-poll share token
 * resumes the share link: a new (not onboarded) user goes to `/p/poll/<token>`
 * instead of straight to /onboarding (the page parks it for the wizard);
 * `invite_code` still wins; an existing user resumes via the saved authRedirect.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Routes, Route, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import type { User } from '../hooks/use-auth';
import { renderWithProviders } from '../test/render-helpers';
import { server } from '../test/mocks/server';
import { saveAuthRedirect } from '../lib/auth-redirect';
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

function renderCallback(code: string) {
    renderWithProviders(
        <>
            <LocationProbe />
            <Routes>
                <Route path="/auth/success" element={<AuthSuccessPage />} />
                <Route path="*" element={<p>Elsewhere</p>} />
            </Routes>
        </>,
        { initialEntries: [`/auth/success?code=${code}`] },
    );
}

const location = () => screen.getByTestId('location');

describe('AuthSuccessPage — pending poll share token (ROK-1750 D5)', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        vi.clearAllMocks();
        server.use(http.post('http://localhost:3000/auth/exchange-code', () => HttpResponse.json({ access_token: 'jwt' })));
    });

    it('a new user with a pending poll token resumes the share link, not /onboarding', async () => {
        auth.user = makeUser(false);
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        renderCallback('c1');
        await waitFor(() => expect(location()).toHaveTextContent('/p/poll/tok_abc'));
        expect(sessionStorage.getItem('poll_share_token'), 'the token is consumed here').toBeNull();
    });

    it('invite_code still wins over a pending poll token', async () => {
        auth.user = makeUser(false);
        sessionStorage.setItem('invite_code', 'ABC123');
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        renderCallback('c2');
        await waitFor(() => expect(location()).toHaveTextContent('/i/ABC123?claim=1'));
        expect(sessionStorage.getItem('invite_code')).toBeNull();
    });

    it('a new user with nothing pending still goes to /onboarding', async () => {
        auth.user = makeUser(false);
        renderCallback('c3');
        await waitFor(() => expect(location()).toHaveTextContent('/onboarding'));
    });

    it('an existing user resumes the share link through the saved auth redirect', async () => {
        auth.user = makeUser(true);
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        saveAuthRedirect('/p/poll/tok_abc');
        renderCallback('c4');
        await waitFor(() => expect(location()).toHaveTextContent('/p/poll/tok_abc'));
    });
});
