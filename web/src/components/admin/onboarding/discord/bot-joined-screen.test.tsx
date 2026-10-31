/**
 * ROK-1703 4e — the bot-joined screen against a path-mocked adminFetch:
 * multi-server alert, the empty-channel hint, and Finish later saving a
 * changed default channel before it hands off (AC-9, AC-10).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/render-helpers';
import { BotJoinedScreen } from './bot-joined-screen';

const fetchMock = vi.fn();
vi.mock('../../../../hooks/admin/admin-fetch', () => ({
    adminFetch: (path: string, init?: RequestInit) => fetchMock(path, init),
}));
vi.mock('../../../../hooks/use-auth', () => ({ getAuthToken: () => 'token' }));

interface Fixture { guildCount?: number; channels?: { id: string; name: string }[] }

function serve({ guildCount = 1, channels = [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'raid-signups' }] }: Fixture = {}): void {
    fetchMock.mockImplementation(async (path: string) => {
        if (path.endsWith('/permissions')) return { allGranted: true, permissions: [{ name: 'View Channels', granted: true }, { name: 'Send Messages', granted: true }] };
        if (path.endsWith('/channels')) return channels;
        if (path.endsWith('/channel')) return { channelId: null };
        return { configured: true, connected: true, guildName: 'Ironforge Raiders', memberCount: 142, guildCount };
    });
}

function renderScreen() {
    const props = { onNext: vi.fn(), onBack: vi.fn(), onFinishLater: vi.fn() };
    const { queryClient } = renderWithProviders(<BotJoinedScreen {...props} />);
    return { ...props, queryClient };
}

describe('BotJoinedScreen (4e)', () => {
    beforeEach(() => { fetchMock.mockReset(); });

    it('shows the server, member count and a passing checklist', async () => {
        serve();
        renderScreen();
        expect(await screen.findByRole('heading', { name: 'Your bot is in Ironforge Raiders' })).toBeInTheDocument();
        expect(screen.getByText('Online · 142 members')).toBeInTheDocument();
        expect(await screen.findByText('All 2 permissions granted')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('warns when the bot is in more than one server', async () => {
        serve({ guildCount: 2 });
        renderScreen();
        expect(await screen.findByRole('alert')).toHaveTextContent('Your bot is in 2 servers.');
    });

    it('explains an empty channel list', async () => {
        serve({ channels: [] });
        renderScreen();
        expect(await screen.findByText(/can't see any text channels yet/)).toBeInTheDocument();
    });

    it('Finish later saves the picked channel, then hands off', async () => {
        serve();
        const { onFinishLater, onNext } = renderScreen();
        const select = await screen.findByTestId('default-channel-select');
        await screen.findByRole('option', { name: '#raid-signups' });
        fireEvent.change(select, { target: { value: 'c2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Finish later' }));
        await waitFor(() => expect(onFinishLater).toHaveBeenCalledTimes(1));
        const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
        expect(put?.[0]).toBe('/admin/settings/discord-bot/channel');
        expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ channelId: 'c2' });
        expect(onNext).not.toHaveBeenCalled();
    });

    it.each(['Continue', 'Finish later'] as const)('%s refreshes the cached onboarding reads before leaving 4e', async (button) => {
        serve();
        const { onNext, onFinishLater, queryClient } = renderScreen();
        const status = ['admin', 'onboarding', 'status'];
        const sources = ['admin', 'onboarding', 'data-sources'];
        queryClient.setQueryData(status, { steps: { discord: false } });
        queryClient.setQueryData(sources, { discord: { configured: false } });
        const staleAtHandOff: boolean[] = [];
        const handOff = () => staleAtHandOff.push(!!queryClient.getQueryState(status)?.isInvalidated, !!queryClient.getQueryState(sources)?.isInvalidated);
        onNext.mockImplementation(handOff);
        onFinishLater.mockImplementation(handOff);
        await screen.findByRole('option', { name: '#raid-signups' });
        fireEvent.click(screen.getByRole('button', { name: button }));
        await waitFor(() => expect(staleAtHandOff).toHaveLength(2));
        expect(staleAtHandOff, 'onboarding status + data-sources invalidated before the hand-off').toEqual([true, true]);
    });
});
