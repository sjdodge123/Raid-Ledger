/**
 * ROK-1893 P1 — `/h/:token`: one card per preview state, signed-out sign-in
 * (saves the return path), "Join the Discord server first" (with and without
 * the bot-made server invite), Join → the hub page, and a 410 on join.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import type { User } from '../hooks/use-auth';
import { renderWithProviders } from '../test/render-helpers';
import { server } from '../test/mocks/server';
import { createMockHubInvitePreview, hubInviteJoinHandler, hubInvitePreviewHandler } from '../test/mocks/hub-invite-handlers';
import { HubInvitePage } from './hub-invite-page';

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('../hooks/use-auth', async () => {
    const actual = await vi.importActual<typeof import('../hooks/use-auth')>('../hooks/use-auth');
    return { ...actual, useAuth: () => ({ user: auth.user, isLoading: false }) };
});
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const member = { id: 42, discordId: 'd-42', username: 'visitor', role: 'member', onboardingCompletedAt: '2026-01-01T00:00:00.000Z' } as User;

function LocationProbe(): JSX.Element {
    const { pathname } = useLocation();
    return <output data-testid="location">{pathname}</output>;
}

function renderPage(token = 'tok_abc'): void {
    renderWithProviders(
        <>
            <LocationProbe />
            <Routes>
                <Route path="/h/:token" element={<HubInvitePage />} />
                <Route path="/guilds/:id" element={<p>Hub page</p>} />
            </Routes>
        </>,
        { initialEntries: [`/h/${token}`] },
    );
}

beforeEach(() => {
    auth.user = null;
    sessionStorage.clear();
});

describe('HubInvitePage', () => {
    it('signed out: preview + "Sign in with Discord to join" saves the return path', async () => {
        server.use(hubInvitePreviewHandler(createMockHubInvitePreview({ inDiscordServer: null })));
        renderPage();
        expect(await screen.findByText('Night Owls')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Sign in with Discord to join' }));
        expect(sessionStorage.getItem('authRedirect')).toBe('/h/tok_abc');
    });

    it.each([
        ['expired', 'This invite link has expired'],
        ['revoked', 'This invite link was revoked'],
        ['exhausted', 'This invite link has been used up'],
    ] as const)('state %s shows its dead card', async (state, title) => {
        server.use(hubInvitePreviewHandler(createMockHubInvitePreview({ state })));
        renderPage();
        expect(await screen.findByRole('alert')).toHaveTextContent(title);
        expect(screen.getByRole('link', { name: 'Browse hubs' })).toHaveAttribute('href', '/hubs');
    });

    it('hub-unavailable and an unknown token (404) say the link doesn’t work', async () => {
        server.use(hubInvitePreviewHandler(createMockHubInvitePreview({ state: 'hub-unavailable', hub: null })));
        renderPage();
        expect(await screen.findByText('The hub may be hidden or not approved yet.')).toBeInTheDocument();
    });

    it('404 preview → invalid-link card', async () => {
        server.use(hubInvitePreviewHandler(404));
        renderPage();
        expect(await screen.findByRole('alert')).toHaveTextContent('This invite link doesn’t work');
    });

    it('signed in, not in the Discord server: offers the bot-made server invite', async () => {
        auth.user = member;
        server.use(hubInvitePreviewHandler(createMockHubInvitePreview({ inDiscordServer: false })));
        renderPage();
        expect(await screen.findByText('Join the Discord server first')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open the Discord invite' })).toHaveAttribute('href', 'https://discord.gg/abc123');
        expect(screen.queryByRole('button', { name: 'Join Night Owls' })).toBeNull();
    });

    it('signed in without a linked Discord account: asks to link it, not to join the server', async () => {
        auth.user = { ...member, discordId: 'local:visitor' } as User;
        server.use(hubInvitePreviewHandler(createMockHubInvitePreview({ inDiscordServer: false })));
        renderPage();
        expect(await screen.findByText('Link your Discord account first')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Link Discord' })).toBeInTheDocument();
        expect(screen.queryByText('Join the Discord server first')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Join Night Owls' })).toBeNull();
    });

    it('signed in, not in the server, no bot invite: text only', async () => {
        auth.user = member;
        server.use(hubInvitePreviewHandler(createMockHubInvitePreview({ inDiscordServer: false, discordServerInviteUrl: null })));
        renderPage();
        expect(await screen.findByText('Join the Discord server first')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Open the Discord invite' })).toBeNull();
    });

    it('signed in + in the server: Join redeems and lands on the hub page', async () => {
        auth.user = member;
        const joins: string[] = [];
        server.use(
            hubInvitePreviewHandler(createMockHubInvitePreview()),
            hubInviteJoinHandler({ hubId: 7, joined: true, memberCount: 13 }, joins),
        );
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Join Night Owls' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/guilds/7'));
        expect(joins).toEqual(['tok_abc']);
    });

    it('a 410 on join shows the dead card for the state in the body', async () => {
        auth.user = member;
        server.use(
            hubInvitePreviewHandler(createMockHubInvitePreview()),
            hubInviteJoinHandler({ status: 410, message: 'gone' }),
        );
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Join Night Owls' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('This invite link has expired');
    });

    it('already a member: Open the hub instead of Join', async () => {
        auth.user = member;
        server.use(hubInvitePreviewHandler(createMockHubInvitePreview({ alreadyMember: true })));
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Open Night Owls' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/guilds/7'));
    });
});
