/**
 * ROK-1832 — the muted-groups list under "Group posts": each group links to its
 * hub with its game name, Unmute sends DELETE, the refetched list drops the
 * group and the viewer's hub-mutes key is invalidated; an empty list shows a
 * one-line empty state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import type { HubNotificationMuteItemDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { createMockHubMute } from '../../test/mocks/hub-notification-mute-handlers';
import { renderWithProviders } from '../../test/render-helpers';
import { setAccessToken } from '../../lib/api/access-token-store';
import { MutedGroupsList } from './muted-groups-list';

const API = 'http://localhost:3000';

/** List reflects the server's mutes; DELETE removes the group. */
function seed(initial: HubNotificationMuteItemDto[]): string[] {
    const deletes: string[] = [];
    let mutes = [...initial];
    server.use(
        http.get(`${API}/notifications/hub-mutes`, () => HttpResponse.json({ data: mutes })),
        http.delete(`${API}/guilds/:id/notification-mute`, ({ params }) => {
            const id = String(params.id);
            deletes.push(id);
            mutes = mutes.filter((m) => String(m.guildId) !== id);
            return HttpResponse.json({ guildId: Number(id), muted: false });
        }),
    );
    return deletes;
}

const VANGUARD = createMockHubMute({ guildId: 7, name: 'Iron Vanguard', gameName: 'World of Warcraft' });
const ONYX = createMockHubMute({ guildId: 9, name: 'Onyx', kind: 'game_server', gameName: null });

beforeEach(() => setAccessToken('test-token'));

describe('MutedGroupsList', () => {
    it('lists each muted group as a link to its hub with its game name', async () => {
        seed([VANGUARD, ONYX]);
        renderWithProviders(<MutedGroupsList />);
        expect(await screen.findByRole('link', { name: 'Iron Vanguard' })).toHaveAttribute('href', '/guilds/7');
        expect(screen.getByRole('link', { name: 'Onyx' })).toHaveAttribute('href', '/guilds/9');
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
        expect(screen.getByTestId('muted-groups-list')).toBeInTheDocument();
    });

    it('Unmute sends DELETE, drops the row and invalidates the hub-mutes key', async () => {
        const deletes = seed([VANGUARD, ONYX]);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const user = userEvent.setup();
        renderWithProviders(<MutedGroupsList />, { queryClient });
        await user.click(await screen.findByRole('button', { name: 'Unmute Iron Vanguard' }));
        await waitFor(() => expect(screen.queryByRole('link', { name: 'Iron Vanguard' })).not.toBeInTheDocument());
        expect(deletes).toEqual(['7']);
        expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({
            queryKey: expect.arrayContaining(['notifications', 'hub-mutes']),
        }));
        expect(screen.getByRole('link', { name: 'Onyx' })).toBeInTheDocument();
    });

    it('shows a one-line empty state when no group is muted', async () => {
        seed([]);
        renderWithProviders(<MutedGroupsList />);
        expect(await screen.findByText(/No muted groups/)).toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
});
