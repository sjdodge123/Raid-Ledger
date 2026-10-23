/**
 * ROK-1893 P3 — the hub block on a hub poll page: "Hub: <name>" links the hub,
 * voter chips carry a "Member" mark only for live hub members, and a signed-in
 * non-member gets Join hub, which joins through `POST /hubs/:id/join` and then
 * refetches the poll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { hubPollsHandlers, type HubPollsCalls } from '../../../test/mocks/hub-polls-handlers';
import { renderWithProviders } from '../../../test/render-helpers';
import { schedulePollKey } from '../../../hooks/use-scheduling';
import { SchedulingHubPanel } from './SchedulingHubPanel';

const auth = vi.hoisted(() => ({ user: { id: 3 } as { id: number } | null }));
vi.mock('../../../hooks/use-auth', () => ({ useAuth: () => ({ user: auth.user, isAuthenticated: auth.user !== null }) }));

type Hub = SchedulePollPageResponseDto['hub'];
const voter = (userId: number, displayName: string, isHubMember?: boolean) => ({
    userId, displayName, avatar: null, discordId: null, customAvatarUrl: null,
    ...(isHubMember === undefined ? {} : { isHubMember }),
});

function buildPoll(hub: Hub, voters = [voter(1, 'Mirelle', true), voter(2, 'Kestrel', false), voter(3, 'You', false)]) {
    return { hub, slots: [{ id: 1, votes: voters, noVotes: [] }, { id: 2, votes: [voters[0]], noVotes: [] }] } as unknown as SchedulePollPageResponseDto;
}
const HUB = { id: 7, name: 'Tavern Regulars', memberCount: 14, viewerIsMember: false };

beforeEach(() => { auth.user = { id: 3 }; });
afterEach(() => { vi.restoreAllMocks(); });

describe('SchedulingHubPanel (ROK-1893 P3)', () => {
    it('renders nothing on an untagged poll', () => {
        renderWithProviders(<SchedulingHubPanel poll={buildPoll(null)} lineupId={40} matchId={41} />);
        expect(screen.queryByTestId('scheduling-hub-panel')).toBeNull();
    });

    it('links the hub and marks only live hub members, once per voter', () => {
        renderWithProviders(<SchedulingHubPanel poll={buildPoll(HUB)} lineupId={40} matchId={41} />);
        expect(screen.getByRole('link', { name: 'Tavern Regulars' })).toHaveAttribute('href', '/hubs/7');
        const chips = within(screen.getByRole('list', { name: 'Voters' })).getAllByRole('listitem');
        expect(chips.map((c) => c.textContent), 'each voter once, Member only on the hub member').toEqual(['MirelleMember', 'Kestrel', 'You']);
    });

    it('a signed-in non-member joins the hub, then the poll refetches', async () => {
        const calls: HubPollsCalls = { listed: [], joined: [] };
        server.use(...hubPollsHandlers([], calls));
        const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        const user = userEvent.setup();
        renderWithProviders(<SchedulingHubPanel poll={buildPoll(HUB)} lineupId={40} matchId={41} />);
        expect(screen.getByTestId('scheduling-hub-join')).toHaveTextContent('You voted. Join Tavern Regulars');
        await user.click(screen.getByRole('button', { name: 'Join hub' }));
        await waitFor(() => expect(calls.joined, 'joins through the hub join route').toEqual([7]));
        await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: schedulePollKey(40, 41) }));
    });

    it('no Join hub for a member or a signed-out viewer', () => {
        const { unmount } = renderWithProviders(<SchedulingHubPanel poll={buildPoll({ ...HUB, viewerIsMember: true })} lineupId={40} matchId={41} />);
        expect(screen.queryByRole('button', { name: 'Join hub' }), 'a member is already in').toBeNull();
        unmount();
        auth.user = null;
        renderWithProviders(<SchedulingHubPanel poll={buildPoll(HUB)} lineupId={40} matchId={41} />);
        expect(screen.queryByRole('button', { name: 'Join hub' }), 'signed-out viewers cannot join').toBeNull();
    });
});
