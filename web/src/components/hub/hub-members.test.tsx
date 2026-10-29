/**
 * ROK-1830 S3b — the Members tab as the page renders it: the WoW module's
 * columns, the search box, the "Group by rank" toggle and the count line.
 * Driven through `GuildPage` so the real WoW hub module is the one under test.
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { GuildMemberRow, GuildPage as GuildPageDto, GuildRaidsDto } from '@raid-ledger/contract';
import type { HubMemberFilters, HubMemberRow, HubModule } from '../../plugins/hub-module';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { Checkbox } from '../ui/checkbox';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { GuildPage } from './hub-page';
import { HubMembers } from './hub-members';

const BASE = 'http://localhost:3000/guilds/7';

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
    renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'] });
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

describe('Members tab — D5 flat/grouped (ROK-1173)', () => {
    it('goes flat while searching and brings the rank bands back when the search clears', async () => {
        renderMembers();
        await screen.findByTestId('guild-members');
        const search = screen.getByRole('searchbox', { name: 'Search members' });
        await userEvent.type(search, 'r');
        await waitFor(() => expect(screen.queryByTestId('guild-rank-2'), 'a search must flatten the bands').toBeNull());
        expect(screen.queryByRole('checkbox', { name: 'Group by rank' }), 'the toggle hides while flat').toBeNull();
        await userEvent.clear(search);
        await waitFor(() => expect(within(screen.getByTestId('guild-rank-2')).getByText('Raider · 2')).toBeInTheDocument());
        expect(listedNames()).toEqual(['Grimtusk', 'Stormcall', 'Nolina']);
    });

    it('sorts flat by name and restores the rank order when the sort goes back to Rank', async () => {
        renderMembers();
        await screen.findByTestId('guild-members');
        const sort = screen.getByRole('combobox', { name: 'Sort by' });
        await userEvent.selectOptions(sort, 'name-asc');
        await waitFor(() => expect(listedNames(), 'Name A–Z must reorder across ranks').toEqual(['Grimtusk', 'Nolina', 'Stormcall']));
        expect(screen.queryByTestId('guild-rank-0')).toBeNull();
        await userEvent.selectOptions(sort, 'rank');
        await waitFor(() => expect(screen.getByTestId('guild-rank-0')).toBeInTheDocument());
        expect(listedNames()).toEqual(['Grimtusk', 'Stormcall', 'Nolina']);
    });
});

/* A stand-in module with one filter ("Warriors only"), driving `HubMembers` directly. */
function useWarriorFilter(): HubMemberFilters {
    const [on, setOn] = useState(false);
    return {
        activeCount: on ? 1 : 0,
        matches: (r: HubMemberRow) => !on || r.class === 'Warrior',
        clearAll: () => setOn(false),
        controls: <Checkbox label="Warriors only" checked={on} onChange={(e) => setOn(e.target.checked)} />,
        lead: <p data-testid="fake-members-lead">Coverage</p>,
    };
}

const FAKE_MODULE: HubModule = {
    kind: 'wow_guild', tabs: [], overviewWidgets: [], heroPills: [],
    memberColumns: [
        { id: 'name', header: 'Name', cell: ({ row: r }) => <span>{r.name}</span> },
        { id: 'rank', header: 'Rank', cell: ({ row: r }) => <span>{r.rankName}</span>,
            groupBy: (r) => ({ key: String(r.rankIndex), label: r.rankName ?? '', testId: `guild-rank-${r.rankIndex}` }) },
    ],
    memberRows: (page) => page.ranks.flatMap((rank) => rank.members),
    memberSearch: (r) => `${r.name} ${r.class ?? ''}`,
    useMemberFilters: useWarriorFilter,
};

function Harness(): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['fake-raids'], queryFn: () => Promise.reject(new Error('unused')), enabled: false });
    return <HubMembers ctx={{ page: PAGE, raids }} module={FAKE_MODULE} />;
}

const originalMatchMedia = window.matchMedia;
function mockDesktop(): void {
    window.matchMedia = (query: string) => ({
        matches: query === DESKTOP_MQ, media: query, onchange: null,
        addListener: () => undefined, removeListener: () => undefined,
        addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    });
}

describe('Members filters — the funnel standard (ROK-1173 AC3/AC10)', () => {
    afterEach(() => { window.matchMedia = originalMatchMedia; });

    it('puts the funnel beside the search from 1024px, filters flat, and Clear all restores the bands', async () => {
        mockDesktop();
        renderWithProviders(<Harness />);
        await userEvent.click(await screen.findByTestId('filter-panel-trigger'));
        expect(screen.queryByTestId('filter-fab'), 'no FAB at desktop width').toBeNull();
        expect(screen.getByTestId('fake-members-lead')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('checkbox', { name: 'Warriors only' }));
        await waitFor(() => expect(listedNames()).toEqual(['Grimtusk', 'Nolina']));
        expect(screen.getByTestId('guild-members-count')).toHaveTextContent('2 of 3 members');
        expect(screen.queryByTestId('guild-rank-0'), 'an active filter must flatten the bands').toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
        await waitFor(() => expect(screen.getByTestId('guild-rank-0')).toBeInTheDocument());
        expect(screen.getByTestId('guild-members-count')).toHaveTextContent('3 members');
    });

    it('uses the Filters FAB below 1024px, with no toolbar funnel', async () => {
        renderWithProviders(<Harness />);
        expect(await screen.findByTestId('filter-fab')).toBeInTheDocument();
        expect(screen.queryByTestId('filter-panel-trigger'), 'no toolbar funnel below 1024px').toBeNull();
    });

    it('says no member matches the filters when a filter empties the list', async () => {
        mockDesktop();
        renderWithProviders(<Harness />);
        await userEvent.click(await screen.findByTestId('filter-panel-trigger'));
        await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'storm');
        await userEvent.click(screen.getByRole('checkbox', { name: 'Warriors only' }));
        await waitFor(() => expect(screen.getByTestId('guild-members-no-match')).toHaveTextContent('No members match “storm”.'));
        await userEvent.clear(screen.getByRole('searchbox', { name: 'Search members' }));
        expect(screen.getByTestId('guild-members-count')).toHaveTextContent('2 of 3 members');
    });
});
