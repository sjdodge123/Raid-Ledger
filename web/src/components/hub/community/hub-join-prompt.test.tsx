/**
 * ROK-1893 P1 (ruling §8d) — the join prompt on the event page: `suggest`
 * offers Join hub / Not now, `auto-joined` is a one-time notice closed by a
 * dismiss; only the prompts this event's signup raised show here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { HubJoinPrompt } from '@raid-ledger/contract';
import type { User } from '../../../hooks/use-auth';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { MY_GUILDS_KEY_PREFIX } from '../api/use-guild-content';
import { HubJoinPrompts } from './hub-join-prompt';
import { HUB_JOIN_PROMPTS_KEY } from './hub-join-prompts-api';

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('../../../hooks/use-auth', async () => {
    const actual = await vi.importActual<typeof import('../../../hooks/use-auth')>('../../../hooks/use-auth');
    return { ...actual, useAuth: () => ({ user: auth.user, isLoading: false }) };
});

const API = 'http://localhost:3000';
const linked = { id: 42, discordId: 'd-42', username: 'visitor', role: 'member', onboardingCompletedAt: '2026-01-01T00:00:00.000Z' } as User;
const calls: string[] = [];
let items: HubJoinPrompt[] = [];
let inDiscordServer = true;
let discordServerInviteUrl: string | null = null;

function prompt(over: Partial<HubJoinPrompt>): HubJoinPrompt {
    return { id: 7, kind: 'suggest', hubId: 41, hubName: 'BG3 Crew', source: 'signup', sourceRef: 12, createdAt: '2026-10-22T12:00:00.000Z', ...over };
}

function record(request: Request): void {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
}

beforeEach(() => {
    calls.length = 0;
    items = [];
    inDiscordServer = true;
    discordServerInviteUrl = null;
    auth.user = linked;
    server.use(
        http.get(`${API}/users/me/hub-join-prompts`, ({ request }) => { record(request); return HttpResponse.json({ items, inDiscordServer, discordServerInviteUrl }); }),
        http.post(`${API}/users/me/hub-join-prompts/:id/accept`, ({ request }) => {
            record(request); items = []; return HttpResponse.json({ hubId: 41, joined: true, memberCount: 4 });
        }),
        http.post(`${API}/users/me/hub-join-prompts/:id/dismiss`, ({ request }) => {
            record(request); items = []; return new HttpResponse(null, { status: 204 });
        }),
    );
});

describe('HubJoinPrompts', () => {
    it('asks "Join <hub>?" for a suggest prompt raised by this event', async () => {
        items = [prompt({})];
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />);
        expect(await screen.findByText('Join BG3 Crew?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join hub' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    });

    it('a viewer outside the Discord server gets "Join the Discord server first" + the invite, no Join hub', async () => {
        items = [prompt({})];
        inDiscordServer = false;
        discordServerInviteUrl = 'https://discord.gg/rl-test';
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />);
        expect(await screen.findByText('Join the Discord server first')).toBeInTheDocument();
        expect(screen.getByTestId('hub-invite-discord-link')).toHaveAttribute('href', 'https://discord.gg/rl-test');
        expect(screen.queryByRole('button', { name: 'Join hub' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    });

    it('without a bot-made server invite the Discord step is text-only', async () => {
        items = [prompt({})];
        inDiscordServer = false;
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />);
        expect(await screen.findByText('Join the Discord server first')).toBeInTheDocument();
        expect(screen.queryByTestId('hub-invite-discord-link')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Join hub' })).not.toBeInTheDocument();
    });

    it('a viewer with no Discord linked gets "Link your Discord account first", no Join hub', async () => {
        items = [prompt({})];
        inDiscordServer = false;
        auth.user = { ...linked, discordId: 'local:visitor' } as User;
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />);
        expect(await screen.findByText('Link your Discord account first')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Link Discord' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Join hub' })).not.toBeInTheDocument();
        expect(screen.queryByText('Join the Discord server first')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    });

    it('hides prompts raised by another event or by a poll vote', async () => {
        items = [prompt({ id: 1, sourceRef: 99 }), prompt({ id: 2, source: 'vote', sourceRef: 12 })];
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />);
        await waitFor(() => expect(calls).toContain('GET /users/me/hub-join-prompts'));
        expect(screen.queryByTestId('hub-join-prompts')).not.toBeInTheDocument();
    });

    it('fetches nothing for a signed-out viewer', () => {
        items = [prompt({})];
        renderWithProviders(<HubJoinPrompts eventId={12} enabled={false} />);
        expect(calls).toEqual([]);
        expect(screen.queryByTestId('hub-join-prompts')).not.toBeInTheDocument();
    });

    it('Join hub accepts the prompt, removes it and refetches the hub membership surfaces', async () => {
        items = [prompt({})];
        const queryClient = createTestQueryClient();
        const spy = vi.spyOn(queryClient, 'invalidateQueries');
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />, { queryClient });
        await userEvent.click(await screen.findByRole('button', { name: 'Join hub' }));
        await waitFor(() => expect(calls).toContain('POST /users/me/hub-join-prompts/7/accept'));
        await waitFor(() => expect(screen.queryByText('Join BG3 Crew?')).not.toBeInTheDocument());
        expect(spy).toHaveBeenCalledWith({ queryKey: MY_GUILDS_KEY_PREFIX });
        expect(spy).toHaveBeenCalledWith({ queryKey: HUB_JOIN_PROMPTS_KEY });
    });

    it('Not now dismisses the prompt', async () => {
        items = [prompt({})];
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />);
        await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
        await waitFor(() => expect(calls).toContain('POST /users/me/hub-join-prompts/7/dismiss'));
        expect(calls).not.toContain('POST /users/me/hub-join-prompts/7/accept');
        await waitFor(() => expect(screen.queryByTestId('hub-join-prompt')).not.toBeInTheDocument());
    });

    it('tells an auto-joined user once, and closing it dismisses the notice', async () => {
        items = [prompt({ id: 8, kind: 'auto-joined' })];
        renderWithProviders(<HubJoinPrompts eventId={12} enabled />);
        const notice = await screen.findByTestId('hub-auto-joined');
        expect(notice).toHaveTextContent('You joined BG3 Crew — leave anytime');
        expect(screen.getByRole('link', { name: 'BG3 Crew' })).toHaveAttribute('href', '/guilds/41');
        expect(screen.queryByRole('button', { name: 'Join hub' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Close the BG3 Crew notice' }));
        await waitFor(() => expect(calls).toContain('POST /users/me/hub-join-prompts/8/dismiss'));
        await waitFor(() => expect(screen.queryByTestId('hub-auto-joined')).not.toBeInTheDocument());
    });
});
