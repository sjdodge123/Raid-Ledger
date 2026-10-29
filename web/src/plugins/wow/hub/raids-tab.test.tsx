/**
 * ROK-1817 — "Schedule for guild" on the WoW Raids tab: editors only, the
 * Create Event deep link for this guild, shown in every raids-query state.
 */
import { describe, it, expect } from 'vitest';
import type { JSX } from 'react';
import { screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { emptyGuildRaids } from '../../../test/mocks/guild-raids-handlers';
import { GuildRaidsTab } from './raids-tab';
import { scheduleForGuildUrl } from './raids-tab.helpers';

const TESTID = 'guild-schedule-for-guild';

function page(canEdit: boolean): GuildPage {
    return {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 1, lastSnapshotAt: null },
        importedBy: null,
        viewer: { role: canEdit ? 'officer' : 'member', canEdit, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

type QueryState = 'loaded' | 'loading' | 'error';

function fetchRaids(state: QueryState): Promise<GuildRaidsDto> {
    if (state === 'loaded') return Promise.resolve(emptyGuildRaids);
    if (state === 'error') return Promise.reject(new Error('boom'));
    return new Promise<GuildRaidsDto>(() => undefined);
}

function Harness({ canEdit, state }: { canEdit: boolean; state: QueryState }): JSX.Element {
    const query = useQuery({ queryKey: ['raids-tab-test', state], queryFn: () => fetchRaids(state), retry: false });
    return <GuildRaidsTab query={query} page={page(canEdit)} />;
}

describe('scheduleForGuildUrl', () => {
    it('builds the Create Event deep link with the game and the guild', () => {
        expect(scheduleForGuildUrl({ id: 7, gameId: 3 })).toBe('/events/new?gameId=3&guildId=7');
    });
});

describe('GuildRaidsTab — Schedule for guild (ROK-1817)', () => {
    it('an editor sees the link, pointing at Create Event pre-linked to this guild', async () => {
        renderWithProviders(<Harness canEdit state="loaded" />);
        await screen.findByTestId('guild-raids-tab');
        const link = screen.getByTestId(TESTID);
        expect(link).toHaveTextContent('Schedule for guild');
        expect(link).toHaveAttribute('href', '/events/new?gameId=3&guildId=7');
    });

    it('a plain member does not see it', async () => {
        renderWithProviders(<Harness canEdit={false} state="loaded" />);
        await screen.findByTestId('guild-raids-tab');
        expect(screen.queryByTestId(TESTID), 'a non-editor must not get "Schedule for guild"').toBeNull();
    });

    it('shows while the raids query is still loading', () => {
        renderWithProviders(<Harness canEdit state="loading" />);
        expect(screen.getByTestId('guild-raids-loading')).toBeInTheDocument();
        expect(screen.getByTestId(TESTID)).toBeInTheDocument();
    });

    it('shows when the raids query failed', async () => {
        renderWithProviders(<Harness canEdit state="error" />);
        await screen.findByTestId('guild-raids-error');
        expect(screen.getByTestId(TESTID)).toBeInTheDocument();
    });
});
