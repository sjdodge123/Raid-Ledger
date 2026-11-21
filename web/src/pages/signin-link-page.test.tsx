/**
 * ROK-2283 — `/signin-link`: the token is NOT spent until Continue is tapped;
 * Continue redeems at the endpoint the token's kind names and lands on
 * Calendar; a 401 shows the used/expired card; an existing session is kept
 * and the link left unspent; a transient failure offers Continue again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { JSX } from 'react';
import type { User } from '../hooks/use-auth';
import { renderWithProviders } from '../test/render-helpers';
import { server } from '../test/mocks/server';
import { clearAccessToken, getAccessToken } from '../lib/api/access-token-store';
import { SigninLinkPage } from './signin-link-page';

const API_BASE = 'http://localhost:3000';
const DISCORD_REDEEM = `${API_BASE}/auth/redeem-discord-link`;
const MAGIC_REDEEM = `${API_BASE}/auth/redeem-magic-link`;

const auth = vi.hoisted(() => ({ user: null as User | null, error: null as Error | null, refetch: vi.fn() }));
vi.mock('../hooks/use-auth', async () => {
    const actual = await vi.importActual<typeof import('../hooks/use-auth')>('../hooks/use-auth');
    return { ...actual, useAuth: () => ({ user: auth.user, isLoading: false, error: auth.error, refetch: auth.refetch }) };
});
const held = vi.hoisted(() => ({ token: null as string | null, clear: vi.fn() }));
vi.mock('../lib/magic-link-capture', () => ({
    peekCapturedSigninLinkToken: () => held.token,
    clearCapturedSigninLinkToken: held.clear,
}));

function fakeJwt(payload: Record<string, unknown>): string {
    return `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.sig`;
}
const SIGNIN_TOKEN = fakeJwt({ discordId: '123456789012345678', username: 'Disco', signin: true, src: 'cmd' });
const MAGIC_TOKEN = fakeJwt({ sub: 7, magicLink: true, tv: 0, src: 'cmd' });

function redeemCounter(url: string, status: number, body: Record<string, unknown>): { calls: number; bodies: unknown[] } {
    const seen = { calls: 0, bodies: [] as unknown[] };
    server.use(http.post(url, async ({ request }) => {
        seen.calls += 1;
        seen.bodies.push(await request.json());
        return HttpResponse.json(body, { status });
    }));
    return seen;
}

function LocationProbe(): JSX.Element {
    return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPage(): void {
    renderWithProviders(
        <>
            <LocationProbe />
            <Routes>
                <Route path="/signin-link" element={<SigninLinkPage />} />
                <Route path="/calendar" element={<p>Calendar page</p>} />
            </Routes>
        </>,
        { initialEntries: ['/signin-link'] },
    );
}

beforeEach(() => {
    auth.user = null;
    auth.error = null;
    auth.refetch.mockReset().mockResolvedValue({});
    held.token = null;
    held.clear.mockReset();
    clearAccessToken();
    server.use(http.get(`${API_BASE}/system/status`, () => HttpResponse.json({ status: 'ok', communityName: 'Night Owls' })));
});

describe('SigninLinkPage', () => {
    it('waits for Continue, then redeems a first-time link at /auth/redeem-discord-link and lands on Calendar', async () => {
        held.token = SIGNIN_TOKEN;
        const discord = redeemCounter(DISCORD_REDEEM, 200, { access_token: 'session.jwt' });
        const magic = redeemCounter(MAGIC_REDEEM, 200, { access_token: 'wrong.jwt' });
        renderPage();
        expect(await screen.findByRole('heading', { name: 'Sign in to Night Owls as Disco' })).toBeInTheDocument();
        expect(discord.calls, 'the token must not be spent before the tap').toBe(0);
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/calendar'));
        expect(discord.calls).toBe(1);
        expect(discord.bodies[0]).toEqual({ token: SIGNIN_TOKEN });
        expect(magic.calls, 'a signin token must never go to the magic endpoint').toBe(0);
        expect(getAccessToken()).toBe('session.jwt');
        expect(auth.refetch).toHaveBeenCalled();
        expect(held.clear).toHaveBeenCalled();
    });

    it('sends an existing member’s magic link to /auth/redeem-magic-link', async () => {
        held.token = MAGIC_TOKEN;
        const discord = redeemCounter(DISCORD_REDEEM, 200, { access_token: 'wrong.jwt' });
        const magic = redeemCounter(MAGIC_REDEEM, 200, { access_token: 'magic.session' });
        renderPage();
        expect(await screen.findByRole('heading', { name: 'Sign in to Night Owls' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/calendar'));
        expect(magic.calls).toBe(1);
        expect(discord.calls, 'a magic token must never go to the discord-link endpoint').toBe(0);
    });

    it('shows the used/expired card when the redeem answers 401, and stays off Calendar', async () => {
        held.token = SIGNIN_TOKEN;
        redeemCounter(DISCORD_REDEEM, 401, { statusCode: 401, message: 'Invalid or expired sign-in link' });
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
        expect(await screen.findByText(/already been used or has expired\. Run \/login in Discord for a new one\./)).toBeInTheDocument();
        expect(screen.getByTestId('location')).toHaveTextContent('/signin-link');
        expect(getAccessToken()).toBeNull();
    });

    it('keeps an existing session and never redeems the link', async () => {
        held.token = SIGNIN_TOKEN;
        auth.user = { id: 1, username: 'already-here', role: 'member' } as User;
        const discord = redeemCounter(DISCORD_REDEEM, 200, { access_token: 'swap.jwt' });
        renderPage();
        expect(await screen.findByRole('heading', { name: 'You’re already signed in as already-here' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
        expect(discord.calls).toBe(0);
        expect(held.clear, 'the link stays unspent and held').not.toHaveBeenCalled();
    });

    it('shows the used/expired card when no token was captured (reload, bare URL) or it is not a sign-in token', () => {
        held.token = null;
        renderPage();
        expect(screen.getByTestId('signin-link-dead')).toBeInTheDocument();
    });

    it('rejects a token whose payload is neither kind', () => {
        held.token = fakeJwt({ sub: 1 });
        renderPage();
        expect(screen.getByTestId('signin-link-dead')).toBeInTheDocument();
    });

    it('offers Continue again after a transient failure, without dropping the token', async () => {
        held.token = SIGNIN_TOKEN;
        const discord = redeemCounter(DISCORD_REDEEM, 503, { message: 'down' });
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t sign you in just now');
        expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
        expect(discord.calls).toBe(1);
        expect(held.clear).not.toHaveBeenCalled();
    });
});
