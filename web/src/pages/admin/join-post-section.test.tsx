/**
 * ROK-1740: the Join post admin card, against the real hook + adminFetch with
 * MSW — nothing posted, posted + pinned, posted + not pinned (warning), the
 * 422 missing-permission list, a 503 toast, and Remove behind a confirm.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { DiscordJoinPostResult, DiscordJoinPostStatus } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { JoinPostSection } from './join-post-section';

vi.mock('../../hooks/use-auth', () => ({ getAuthToken: () => 'test-token' }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toast', () => ({
    toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const URL = 'http://localhost:3000/admin/settings/discord-bot/join-post';
const CHANNELS = [{ id: 'c1', name: 'welcome' }, { id: 'c2', name: 'general' }];
const NONE: DiscordJoinPostStatus = { channelId: null, messageId: null };
const POSTED: DiscordJoinPostStatus = { channelId: 'c1', messageId: 'm1' };
const result = (over: Partial<DiscordJoinPostResult> = {}): DiscordJoinPostResult =>
    ({ outcome: 'created', channelId: 'c1', messageId: 'm1', pinned: true, warning: null, ...over });

function serve(status: DiscordJoinPostStatus, post?: () => Response) {
    server.use(
        http.get(URL, () => HttpResponse.json(status)),
        http.get('http://localhost:3000/admin/settings/discord-bot/channels', () => HttpResponse.json(CHANNELS)),
        ...(post ? [http.post(URL, post)] : []),
    );
}
const channel = () => screen.getByRole('combobox', { name: 'Channel' });
const button = (name: string) => screen.getByRole('button', { name });
const status = () => screen.getByTestId('join-post-status');

async function renderCard() {
    renderWithProviders(<JoinPostSection />);
    await waitFor(() => expect(screen.getByRole('option', { name: '#welcome' })).toBeInTheDocument());
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe('JoinPostSection (ROK-1740) — states', () => {
    it('nothing posted: Post label, Remove disabled, Post disabled until a channel is picked', async () => {
        serve(NONE);
        await renderCard();
        await waitFor(() => expect(channel()).toBeEnabled());
        expect(status()).toHaveTextContent('Not posted yet.');
        expect(button('Post')).toBeDisabled();
        expect(button('Remove')).toBeDisabled();
        fireEvent.change(channel(), { target: { value: 'c2' } });
        await waitFor(() => expect(button('Post')).toBeEnabled());
    });

    it('posted: Re-post label, stored channel selected, status names the channel', async () => {
        serve(POSTED);
        await renderCard();
        await waitFor(() => expect(status()).toHaveTextContent('Posted in #welcome'));
        expect(channel()).toHaveValue('c1');
        expect(button('Re-post')).toBeEnabled();
        expect(button('Remove')).toBeEnabled();
    });

    it('posting sends the picked channel; pinned → status says pinned, no warning', async () => {
        let body: unknown = null;
        serve(NONE, () => HttpResponse.json(result({ channelId: 'c2' })));
        server.use(http.post(URL, async ({ request }) => {
            body = await request.json();
            return HttpResponse.json(result({ channelId: 'c2' }));
        }));
        await renderCard();
        fireEvent.change(channel(), { target: { value: 'c2' } });
        fireEvent.click(button('Post'));
        await waitFor(() => expect(status()).toHaveTextContent('Posted in #general · pinned'));
        expect(body).toEqual({ channelId: 'c2' });
        expect(button('Re-post')).toBeEnabled();
        expect(screen.queryByTestId('join-post-pin-warning')).not.toBeInTheDocument();
        expect(toastSuccess).toHaveBeenCalledWith('Join post created in #general');
    });

    it('posted but not pinned → warning banner carries the server reason', async () => {
        const warning = 'The bot needs Manage Messages to pin it.';
        serve(POSTED, () => HttpResponse.json(result({ outcome: 'edited', pinned: false, warning })));
        await renderCard();
        fireEvent.click(await screen.findByRole('button', { name: 'Re-post' }));
        // Settle on the success toast, then state the banner synchronously so a
        // missing banner fails on its own message, not a find timeout.
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Join post edited in #welcome'));
        expect(screen.queryByTestId('join-post-pin-warning')?.textContent ?? null)
            .toBe(`Posted, but not pinned. ${warning}`);
        expect(status()).toHaveTextContent('Posted in #welcome · not pinned');
    });
});

describe('JoinPostSection (ROK-1740) — errors', () => {
    it('422 lists every missing permission for the channel, no toast', async () => {
        serve(POSTED, () => HttpResponse.json(
            { message: "The bot can't post in #welcome.", missing: ['Embed Links', 'Manage Messages'] }, { status: 422 }));
        await renderCard();
        fireEvent.click(await screen.findByRole('button', { name: 'Re-post' }));
        // Settle on either outcome (banner or toast), then assert which one won.
        await waitFor(() => expect(toastError.mock.calls.length
            + screen.queryAllByTestId('join-post-missing').length).toBeGreaterThan(0));
        expect(toastError).not.toHaveBeenCalled();
        const banner = screen.getByTestId('join-post-missing');
        expect(banner).toHaveTextContent("The bot can't post here. Missing in #welcome:");
        expect(within(banner).getAllByRole('listitem').map((li) => li.textContent))
            .toEqual(['Embed Links', 'Manage Messages']);
    });

    it('503 toasts the server message and shows no permission banner', async () => {
        serve(POSTED, () => HttpResponse.json({ message: 'The Discord bot is offline.' }, { status: 503 }));
        await renderCard();
        fireEvent.click(await screen.findByRole('button', { name: 'Re-post' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('The Discord bot is offline.'));
        expect(screen.queryByTestId('join-post-missing')).not.toBeInTheDocument();
        expect(status()).toHaveTextContent('Posted in #welcome');
    });

    it('Remove asks first, then DELETEs and resets to Not posted yet', async () => {
        const del = vi.fn(() => HttpResponse.json({ removed: true }));
        serve(POSTED);
        server.use(http.delete(URL, del));
        await renderCard();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
        expect(del).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove post' }));
        await waitFor(() => expect(status()).toHaveTextContent('Not posted yet.'));
        expect(del).toHaveBeenCalledTimes(1);
        expect(button('Post')).toBeInTheDocument();
    });
});
