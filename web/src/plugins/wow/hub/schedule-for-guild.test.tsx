/**
 * ROK-2050 — the WoW guild module's `eventsLead` puts "Schedule for guild" on
 * the core Events tab: editors only, same Create Event deep link as the Raids tab.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { GuildPage } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import { createMockActivePoll, hubPollsHandlers, type HubPollsCalls } from '../../../test/mocks/hub-polls-handlers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { wowHubModule } from './register-hub';
import { WowEventsLead } from './schedule-for-guild';

const TESTID = 'guild-schedule-for-guild';

function page(canEdit: boolean, extra: { gameSlug?: string; role?: GuildPage['viewer']['role'] } = {}): GuildPage {
    const { gameSlug, role } = extra;
    return {
        guild: {
            id: 7, gameId: 3, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde',
            memberCount: 1, lastSnapshotAt: null, ...(gameSlug !== undefined ? { gameSlug } : {}),
        },
        importedBy: null,
        viewer: { role: role ?? (canEdit ? 'officer' : 'member'), canEdit, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

describe('wowHubModule.eventsLead — Schedule for guild on the Events tab (ROK-2050)', () => {
    it('an editor sees the link, pointing at Create Event pre-linked to this guild', () => {
        expect(wowHubModule.eventsLead, 'the WoW guild module must fill the eventsLead slot').toBe(WowEventsLead);
        renderWithProviders(<WowEventsLead page={page(true)} />);
        const link = screen.getByTestId(TESTID);
        expect(link).toHaveTextContent('Schedule for guild');
        expect(link).toHaveAttribute('href', '/events/new?gameId=3&guildId=7');
    });

    it('a plain member does not see it', () => {
        expect(wowHubModule.eventsLead, 'the WoW guild module must fill the eventsLead slot').toBe(WowEventsLead);
        renderWithProviders(<WowEventsLead page={page(false)} />);
        expect(screen.queryByTestId(TESTID), 'a non-editor must not get "Schedule for guild"').toBeNull();
    });
});

describe('wowHubModule.eventsLead — a Forever guild hub lists its tagged polls (ROK-2212, F1 ruling)', () => {
    it('a plain member sees the guild-hub-tagged poll and may start a new one', async () => {
        const calls: HubPollsCalls = { listed: [], joined: [] };
        server.use(...hubPollsHandlers([createMockActivePoll({ gameName: 'WoW: Forever' })], calls));
        renderWithProviders(<WowEventsLead page={page(false, { gameSlug: WOW_FOREVER_GAME_SLUG })} />);
        expect(screen.queryByTestId('hub-polls-section'), 'a Forever guild hub’s Events tab must carry Open polls').not.toBeNull();
        const rows = await screen.findAllByTestId('hub-poll-row');
        expect(rows, 'the poll tagged to this guild hub is listed on its Events tab').toHaveLength(1);
        expect(calls.listed, 'reads this guild hub’s polls').toEqual([7]);
        expect(screen.getByRole('button', { name: 'New poll' }), 'a guild member may start a hub poll').toBeInTheDocument();
        expect(screen.queryByTestId(TESTID), 'a non-editor still gets no "Schedule for guild"').toBeNull();
    });

    it('a visitor sees the list but no New poll', async () => {
        server.use(...hubPollsHandlers([createMockActivePoll()]));
        renderWithProviders(<WowEventsLead page={page(false, { gameSlug: WOW_FOREVER_GAME_SLUG, role: 'visitor' })} />);
        expect(screen.queryByTestId('hub-polls-section'), 'a visitor still sees the guild hub’s Open polls').not.toBeNull();
        expect(await screen.findAllByTestId('hub-poll-row')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'New poll' }), 'a visitor may not start a guild-hub poll').toBeNull();
    });

    it('a non-Forever WoW guild hub gets no polls section', () => {
        renderWithProviders(<WowEventsLead page={page(true, { gameSlug: 'world-of-warcraft' })} />);
        expect(screen.queryByTestId('hub-polls-section'), 'polls are tagged only to Forever guild hubs').toBeNull();
    });
});
