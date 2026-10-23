/**
 * ROK-1893 P3 — the hub Events tab's "Open polls": rows from
 * `GET /hubs/:id/polls` with a visibility chip, an empty state, and "New poll"
 * only for live members, opening CreatePollModal locked to the hub.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../../test/mocks/server';
import { createMockActivePoll, hubPollsHandlers, type HubPollsCalls } from '../../../test/mocks/hub-polls-handlers';
import { renderWithProviders } from '../../../test/render-helpers';
import type { User } from '../../../hooks/use-auth';
import { canCreateHubPoll } from './hub-polls.helpers';
import { buildCommunityPage } from '../../../test/factories/community-hub';
import type { HubCtx } from '../../../plugins/hub-module';
import { communityHubModule } from '../community/community-hub-module';
import { HubPollsSection } from './hub-polls-section';

const PROPS = { hubId: 7, hubName: 'Tavern Regulars', gameId: 5 };

describe('HubPollsSection (ROK-1893 P3)', () => {
    it('lists the hub polls with a Public / Link only chip, linking each poll', async () => {
        const calls: HubPollsCalls = { listed: [], joined: [] };
        server.use(...hubPollsHandlers([
            createMockActivePoll(),
            createMockActivePoll({ matchId: 52, lineupId: 50, gameName: 'Act 3 night', visibility: 'private', slotCount: 1 }),
        ], calls));
        renderWithProviders(<HubPollsSection {...PROPS} canCreate={false} />);
        const rows = await screen.findAllByTestId('hub-poll-row');
        expect(rows, 'one row per open hub poll').toHaveLength(2);
        expect(calls.listed, 'reads this hub’s polls').toEqual([7]);
        const [first, second] = rows;
        if (!first || !second) throw new Error('rows missing');
        expect(within(first).getByText('Public')).toBeInTheDocument();
        expect(within(first).getByRole('link', { name: "Baldur's Gate 3" })).toHaveAttribute('href', '/community-lineup/40/schedule/41');
        expect(within(second).getByText('Link only')).toBeInTheDocument();
        expect(within(second).getByText(/1 time ·/)).toBeInTheDocument();
    });

    it('shows an empty state when the hub has no open polls', async () => {
        server.use(...hubPollsHandlers([]));
        renderWithProviders(<HubPollsSection {...PROPS} canCreate={false} />);
        expect(await screen.findByTestId('hub-polls-empty')).toHaveTextContent('No open polls yet.');
    });

    it('hides New poll from a non-member', async () => {
        server.use(...hubPollsHandlers([]));
        renderWithProviders(<HubPollsSection {...PROPS} canCreate={false} />);
        await screen.findByTestId('hub-polls-empty');
        expect(screen.queryByRole('button', { name: 'New poll' }), 'only live members may start a hub poll').toBeNull();
    });

    it('New poll opens the modal locked to the hub and tagged to it', async () => {
        server.use(...hubPollsHandlers([]));
        const user = userEvent.setup();
        renderWithProviders(<HubPollsSection {...PROPS} canCreate={true} />);
        await user.click(screen.getByRole('button', { name: 'New poll' }));
        const line = await screen.findByTestId('create-poll-hub-line');
        expect(line).toHaveTextContent('Tagged to Tavern Regulars');
        expect(screen.queryByTestId('game-search-input'), 'the game is locked to the hub’s game').toBeNull();
    });
});

describe('communityHubModule.eventsLead (ROK-1893 P3)', () => {
    const raids = {} as HubCtx['raids'];

    it('puts Open polls on a community hub Events tab, with New poll only for a joined viewer', async () => {
        server.use(...hubPollsHandlers([createMockActivePoll()]));
        const Lead = communityHubModule.eventsLead;
        if (!Lead) throw new Error('community module has no eventsLead slot');
        const { unmount } = renderWithProviders(<Lead page={buildCommunityPage({ community: { viewerJoined: true } })} raids={raids} />);
        expect(await screen.findAllByTestId('hub-poll-row'), 'the hub polls render in the slot').toHaveLength(1);
        expect(screen.getByRole('button', { name: 'New poll' }), 'a joined viewer may start a poll').toBeInTheDocument();
        unmount();
        renderWithProviders(<Lead page={buildCommunityPage({ community: { viewerJoined: false } })} raids={raids} />);
        await screen.findAllByTestId('hub-poll-row');
        expect(screen.queryByRole('button', { name: 'New poll' }), 'a visitor gets no New poll').toBeNull();
    });
});

describe('canCreateHubPoll (ROK-1893 P3)', () => {
    it('lets a joined member or staff create, not a plain non-member', () => {
        expect(canCreateHubPoll(true, null), 'joined member').toBe(true);
        expect(canCreateHubPoll(false, { id: 1, role: 'admin' } as User), 'admin').toBe(true);
        expect(canCreateHubPoll(false, { id: 1, role: 'operator' } as User), 'operator').toBe(true);
        expect(canCreateHubPoll(false, { id: 1, role: 'member' } as User), 'plain non-member').toBe(false);
    });
});
