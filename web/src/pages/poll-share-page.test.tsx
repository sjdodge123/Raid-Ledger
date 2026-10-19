/**
 * ROK-1750 — `/p/poll/:token`:
 *  - anonymous: preview + Sign in parks the token AND the auth redirect (D5);
 *    nothing is redeemed.
 *  - unknown / reset token: the one invalid-link card.
 *  - signed-in + onboarded: join, then replace-navigate to the canonical poll
 *    (toast only when newly joined; an already-joined viewer just lands).
 *  - signed-in, not onboarded: park the token, go to /onboarding, no join.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import type { User } from '../hooks/use-auth';
import { renderWithProviders } from '../test/render-helpers';
import { server } from '../test/mocks/server';
import {
    createMockPollSharePreview, pollSharePreviewHandler, pollShareJoinHandler,
} from '../test/mocks/poll-share-handlers';
import { toast } from '../lib/toast';
import { PollSharePage } from './poll-share-page';
import { INVALID_LINK_COPY, CANT_JOIN_COPY } from './poll-share/poll-share-cards';

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('../hooks/use-auth', async () => {
    const actual = await vi.importActual<typeof import('../hooks/use-auth')>('../hooks/use-auth');
    return { ...actual, useAuth: () => ({ user: auth.user, isLoading: false }) };
});
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const POLL_PATH = '/community-lineup/2/schedule/1';

function makeUser(onboarded: boolean, role: User['role'] = 'member'): User {
    return {
        id: 42, discordId: 'd-42', username: 'visitor', displayName: null, avatar: null,
        customAvatarUrl: null, role, steamId: null,
        onboardingCompletedAt: onboarded ? '2026-01-01T00:00:00.000Z' : null,
    } as User;
}

function LocationProbe(): JSX.Element {
    const { pathname } = useLocation();
    return <output data-testid="location">{pathname}</output>;
}

function renderPage(token = 'tok_abc') {
    return renderWithProviders(
        <>
            <LocationProbe />
            <Routes>
                <Route path="/p/poll/:token" element={<PollSharePage />} />
                <Route path="/community-lineup/:lineupId/schedule/:matchId" element={<p>Poll page</p>} />
                <Route path="/onboarding" element={<p>Onboarding</p>} />
            </Routes>
        </>,
        { initialEntries: [`/p/poll/${token}`] },
    );
}

let joinCalls: string[];
beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    auth.user = null;
    joinCalls = [];
    server.use(
        pollSharePreviewHandler(createMockPollSharePreview()),
        pollShareJoinHandler({ lineupId: 2, matchId: 1, joined: true }, joinCalls),
    );
});

describe('PollSharePage — signed out (ROK-1750)', () => {
    it('renders the preview (game, inviter, Open) and does not join', async () => {
        renderPage();
        expect(await screen.findByRole('heading', { name: 'Civilization VI' })).toBeInTheDocument();
        expect(screen.getByText('Roknua invited you to vote on a time to play')).toBeInTheDocument();
        expect(screen.getByTestId('poll-share-status')).toHaveTextContent('Open');
        expect(joinCalls, 'an anonymous visitor must never redeem').toEqual([]);
    });

    it('Sign in with Discord parks the token AND the auth redirect back to the link', async () => {
        const user = userEvent.setup();
        renderPage();
        await user.click(await screen.findByRole('button', { name: 'Sign in with Discord' }));
        expect(sessionStorage.getItem('poll_share_token')).toBe('tok_abc');
        expect(sessionStorage.getItem('authRedirect')).toBe('/p/poll/tok_abc');
    });

    it('an unknown or reset token shows the invalid-link card', async () => {
        server.use(pollSharePreviewHandler(404));
        renderPage('tok_gone');
        expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK_COPY);
        expect(screen.queryByRole('button', { name: 'Sign in with Discord' })).toBeNull();
    });
});

describe('PollSharePage — signed in (ROK-1750)', () => {
    it('an onboarded member joins, gets the toast and lands on the canonical poll', async () => {
        auth.user = makeUser(true);
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        renderPage();
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(POLL_PATH));
        expect(joinCalls).toEqual(['tok_abc']);
        expect(toast.success).toHaveBeenCalledWith("You've joined this poll.");
        expect(sessionStorage.getItem('poll_share_token'), 'a redeemed token must be cleared').toBeNull();
    });

    it('an already-joined member lands on the poll with no "joined" toast (idempotent)', async () => {
        server.use(pollShareJoinHandler({ lineupId: 2, matchId: 1, joined: false }, joinCalls));
        auth.user = makeUser(true);
        renderPage();
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(POLL_PATH));
        expect(joinCalls).toEqual(['tok_abc']);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('a member who has not onboarded parks the token and goes to /onboarding without joining', async () => {
        auth.user = makeUser(false);
        renderPage();
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/onboarding'));
        expect(sessionStorage.getItem('poll_share_token')).toBe('tok_abc');
        expect(joinCalls, 'redeeming before onboarding would bounce and drop the destination').toEqual([]);
    });

    it('an admin who has not onboarded still joins (AuthGuard does not force admins)', async () => {
        auth.user = makeUser(false, 'admin');
        renderPage();
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(POLL_PATH));
        expect(joinCalls).toEqual(['tok_abc']);
    });

    it('a join rejected as no longer valid shows the invalid-link card', async () => {
        server.use(pollShareJoinHandler({ status: 404, message: 'This link is no longer valid' }, joinCalls));
        auth.user = makeUser(true);
        renderPage();
        expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK_COPY);
        expect(screen.getByTestId('location')).toHaveTextContent('/p/poll/tok_abc');
    });

    it('a failed join clears the parked token so a later sign-in cannot replay it', async () => {
        server.use(pollShareJoinHandler({ status: 404, message: 'This link is no longer valid' }, joinCalls));
        auth.user = makeUser(true);
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        renderPage();
        expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK_COPY);
        expect(sessionStorage.getItem('poll_share_token'), 'a failed join must clear the parked token').toBeNull();
    });

    it('a token holding an encoded path separator is never redeemed (ROK-1845)', async () => {
        auth.user = makeUser(true);
        renderPage('..%2F..%2Flineups%2F5%2Fmatches%2F7');
        expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK_COPY);
        expect(joinCalls, 'a traversal token must never reach the join POST').toEqual([]);
        expect(sessionStorage.getItem('poll_share_token')).toBeNull();
    });

    it('a join refused for this account (403) shows the can\'t-join card', async () => {
        server.use(pollShareJoinHandler({ status: 403, message: 'Account is deactivated' }, joinCalls));
        auth.user = makeUser(true);
        renderPage();
        expect(await screen.findByRole('alert')).toHaveTextContent(CANT_JOIN_COPY);
    });
});
