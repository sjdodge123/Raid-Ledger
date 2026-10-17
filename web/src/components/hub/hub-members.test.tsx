/**
 * ROK-1830 S3b — the Members tab as the page renders it: the WoW module's
 * columns, the search box, the "Group by rank" toggle and the count line.
 * Driven through `GuildPage` so the real WoW hub module is the one under test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { GuildMemberRow, GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { GuildPage } from './hub-page';

const BASE = 'http://localhost:3000/plugins/wow/guilds/7';

function row(memberId: number, name: string, cls: string, rankIndex: number, rankName: string): GuildMemberRow {
    return { memberId, name, class: cls, level: 60, rankIndex, rankName, effectiveRole: null, characterId: null, isMain: false };
}

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: 'doomhowl', realmName: 'Doomhowl', faction: 'Horde', memberCount: 3, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [
        { rankIndex: 0, rankName: 'Guild Master', members: [row(1, 'Grimtusk', 'Warrior', 0, 'Guild Master')] },
        { rankIndex: 2, rankName: 'Raider', members: [row(2, 'Stormcall', 'Shaman', 2, 'Raider'), row(3, 'Nolina', 'Warrior', 2, 'Raider')] },
    ],
    roleCounts: { tank: 1, healer: 1, dps: 1, unknown: 0 },
};

function renderMembers(): void {
    window.location.hash = '#members';
    server.use(http.get(BASE, () => HttpResponse.json(PAGE)));
    renderWithProviders(<Routes><Route path="/guilds/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/guilds/7'] });
}

/** The names the list shows right now, in order. */
function listedNames(): string[] {
    return screen.getAllByTestId('guild-member-row').map((el) => el.firstElementChild?.textContent ?? '');
}

beforeEach(() => { activateWowPlugin(); });
afterEach(() => { window.location.hash = ''; });

describe('Members tab (ROK-1830 S3b)', () => {
    it('lists every member, grouped by the module column, with the count line', async () => {
        renderMembers();
        const members = await screen.findByTestId('guild-members');
        expect(within(members).getByRole('heading', { name: 'Members' })).toBeInTheDocument();
        expect(within(members).getByTestId('guild-members-count')).toHaveTextContent('3 members');
        expect(within(screen.getByTestId('guild-rank-2')).getByText('Raider · 2')).toBeInTheDocument();
        expect(listedNames()).toEqual(['Grimtusk', 'Stormcall', 'Nolina']);
    });

    it('narrows the list to the module’s searchable text and says how many are left', async () => {
        renderMembers();
        await screen.findByTestId('guild-members');
        await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'warrior');
        await waitFor(() => expect(
            listedNames(),
            'searching a WoW class must keep only the Warriors',
        ).toEqual(['Grimtusk', 'Nolina']));
        expect(screen.getByTestId('guild-members-count')).toHaveTextContent('2 of 3 members');
        expect(screen.queryByTestId('guild-members-no-match')).toBeNull();
    });

    it('says so when nothing matches, instead of showing an empty list', async () => {
        renderMembers();
        await screen.findByTestId('guild-members');
        await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'zzz');
        await waitFor(() => expect(screen.getByTestId('guild-members-no-match')).toHaveTextContent('No members match “zzz”.'));
        expect(screen.queryAllByTestId('guild-member-row')).toHaveLength(0);
        expect(screen.getByTestId('guild-members-count')).toHaveTextContent('0 of 3 members');
    });

    it('drops the rank bands when the module’s grouping toggle is switched off', async () => {
        renderMembers();
        await screen.findByTestId('guild-members');
        const toggle = screen.getByRole('checkbox', { name: 'Group by rank' });
        expect(toggle).toBeChecked();
        await userEvent.click(toggle);
        await waitFor(() => expect(screen.queryByTestId('guild-rank-2'), 'ungrouping must remove the rank bands').toBeNull());
        expect(listedNames()).toEqual(['Grimtusk', 'Stormcall', 'Nolina']);
    });
});
