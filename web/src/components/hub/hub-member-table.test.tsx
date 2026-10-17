/**
 * ROK-1830 r1 — the desktop half of the Members list. `hub-members.test.tsx`
 * drives the phone cards (jsdom reports no match for `DESKTOP_MQ`), so the
 * table shell went unasserted: this file stubs `matchMedia` to the desktop
 * query and proves the split picks `HubMemberTable` and that the table head
 * carries one `<th>` per module column, in the module's order.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { GuildMemberRow, GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { WOW_MEMBER_COLUMNS } from '../../plugins/wow/hub/wow-members.helpers';
import { GuildPage } from './hub-page';

const BASE = 'http://localhost:3000/plugins/wow/guilds/7';
const originalMatchMedia = window.matchMedia;

/** Only `DESKTOP_MQ` matches, so a motion- or phone-gated branch stays itself. */
const matchMediaStub: typeof window.matchMedia = (query: string) => ({
    matches: query === DESKTOP_MQ, media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    dispatchEvent: () => false,
});

function mockDesktop(): void {
    window.matchMedia = matchMediaStub;
}

function row(memberId: number, name: string, rankIndex: number, rankName: string): GuildMemberRow {
    return { memberId, name, class: 'Warrior', level: 60, rankIndex, rankName, effectiveRole: null, characterId: null, isMain: false };
}

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: 'doomhowl', realmName: 'Doomhowl', faction: 'Horde', memberCount: 2, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [
        { rankIndex: 0, rankName: 'Guild Master', members: [row(1, 'Grimtusk', 0, 'Guild Master')] },
        { rankIndex: 2, rankName: 'Raider', members: [row(2, 'Stormcall', 2, 'Raider')] },
    ],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 2 },
};

afterEach(() => { window.matchMedia = originalMatchMedia; window.location.hash = ''; });

describe('HubMemberTable (desktop shell)', () => {
    it('renders the table with one head cell per module column, and no cards', async () => {
        mockDesktop();
        activateWowPlugin();
        window.location.hash = '#members';
        server.use(http.get(BASE, () => HttpResponse.json(PAGE)));
        renderWithProviders(<Routes><Route path="/guilds/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/guilds/7'] });

        const table = await screen.findByTestId('guild-members-table');
        expect(screen.queryByTestId('guild-members-cards'), 'the desktop branch must not render the phone cards').toBeNull();
        const heads = within(table).getAllByRole('columnheader').filter((th) => th.getAttribute('scope') === 'col');
        expect(heads.map((th) => th.textContent)).toEqual(WOW_MEMBER_COLUMNS.map((c) => c.header));
        expect(within(table).getAllByTestId('guild-member-row')).toHaveLength(2);
        expect(within(table).getByText('Grimtusk')).toBeInTheDocument();
    });
});
