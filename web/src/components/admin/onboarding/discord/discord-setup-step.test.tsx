/**
 * ROK-1703 D-2 / AC-8 — the Discord step starts at the derived sub-step and
 * then stays put: a resumed admin waiting on 4d sees the join on 4d (with
 * Continue enabled) instead of being swapped to 4e when the bot status
 * changes underneath them. adminFetch is mocked per path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/render-helpers';
import { DiscordSetupStep } from './discord-setup-step';

const fetchMock = vi.fn();
vi.mock('../../../../hooks/admin/admin-fetch', () => ({ adminFetch: (path: string) => fetchMock(path) }));
vi.mock('../../../../hooks/use-auth', () => ({ getAuthToken: () => 'token' }));

const KEYS_SAVED = { steps: [
    { key: 'oauth', completed: true }, { key: 'bot-token', completed: true },
    { key: 'bot-connected', completed: false }, { key: 'default-channel', completed: false },
] };

/** Keys saved; the bot reports joined once `state.joined` flips. */
function stubServer(state: { joined: boolean }): void {
    fetchMock.mockImplementation(async (path: string) => {
        if (path.endsWith('/setup-status')) return KEYS_SAVED;
        if (path.endsWith('/invite-url')) return { url: 'https://discord.com/oauth2/authorize?client_id=1', permissions: [], clientId: '1' };
        if (path.endsWith('/permissions')) return { allGranted: true, permissions: [{ name: 'View Channels', granted: true }] };
        if (path.endsWith('/channels')) return [];
        return state.joined
            ? { configured: true, connected: true, guildName: 'Ironforge Raiders', guildCount: 1 }
            : { configured: true, connected: false };
    });
}

const titleText = (): string | null | undefined => document.querySelector('#discord-substep-title')?.textContent;

describe('DiscordSetupStep', () => {
    beforeEach(() => { fetchMock.mockReset(); });

    it('a resumed admin on 4d sees the bot join on 4d, not a jump to 4e', async () => {
        const state = { joined: false };
        stubServer(state);
        const nav = { onNext: vi.fn(), onBack: vi.fn(), onFinishLater: vi.fn() };
        const { queryClient } = renderWithProviders(<DiscordSetupStep {...nav} />);
        await waitFor(() => expect(titleText()).toBe('Invite your bot to your server'));

        state.joined = true;
        await act(async () => { await queryClient.refetchQueries({ queryKey: ['admin', 'settings', 'discord-bot'], exact: true }); });

        // The join has rendered (4d's status line, or 4e's title if the screen were swapped).
        await waitFor(() => expect(screen.queryAllByText(/Ironforge Raiders/).length).toBeGreaterThan(0));
        expect(titleText()).toBe('Invite your bot to your server');
        await waitFor(() => expect(screen.getByTestId('bot-join-status').getAttribute('data-state')).toBe('joined'));
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });
});
