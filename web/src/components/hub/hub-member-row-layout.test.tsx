/**
 * ROK-2155 — the Members row on a phone: (1) a `cardLine: 'own'` column
 * (WoW professions) gets a third line of its own instead of being crammed
 * into the meta line, and the windowed list counts the taller card; (2) a hub
 * kind whose column sets `rowLink` makes the whole row open that column's ONE
 * link: a stretched `::after` on the phone card, a mouse-only `onClick` on the
 * desktop table row (a stretched link on a `<tr>` is unreliable in WebKit).
 */
import type { JSX } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { GuildMemberRow } from '@raid-ledger/contract';
import type { HubMemberColumn } from '../../plugins/hub-module';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import { MOCK_CHAR_IDS, PROFESSIONS_FIXTURE, rosterInsightsHandler } from '../../test/handlers/forever-hub-widgets';
import { WOW_MEMBER_COLUMNS } from '../../plugins/wow/hub/wow-members.helpers';
import { communityHubModule } from './community/community-hub-module';
import { CharacterLink } from './character-link';
import { bandMembers } from './hub-members.helpers';
import { HubMemberCards, HubMemberTable } from './hub-member-table';
import { HubMemberVirtualList, OVERSCAN } from './hub-member-virtual-list';
import { CARD_METRICS, cardMetrics, cardRowHeight, virtualSlice } from './hub-member-virtual.helpers';

// The roster-insights query (professions) only runs for a signed-in member.
vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const LINKED = '11111111-1111-4111-8111-111111111111';

function row(over: Partial<GuildMemberRow> = {}): GuildMemberRow {
    return { memberId: 42, name: 'Aldren', class: 'Hunter', level: 60, rankIndex: 0, rankName: 'Guild Master', effectiveRole: null, characterId: null, isMain: false, ...over };
}

const OWN_LINE: HubMemberColumn[] = [
    { id: 'name', header: 'Name', cell: ({ row: r }) => <span>{r.name}</span> },
    { id: 'rank', header: 'Rank', cell: ({ row: r }) => <span data-testid="cell-rank">{r.rankName}</span> },
    { id: 'prof', header: 'Professions', cell: () => <span data-testid="cell-prof">Herbalism 300</span>, cardLine: 'own' },
];

/** A core-style link cell that does NOT opt into `rowLink` (community / pelican shape). */
const NO_ROW_LINK: HubMemberColumn[] = [
    { id: 'player', header: 'Player', cell: ({ row: r, stretched }) => <CharacterLink name={r.name} characterId={LINKED} stretched={stretched === true} /> },
    { id: 'rank', header: 'Rank', cell: ({ row: r }) => <span>{r.rankName}</span> },
];

function slice(rows: readonly GuildMemberRow[], columns: readonly HubMemberColumn[]) {
    return virtualSlice(bandMembers(rows, undefined), cardMetrics(columns), 0, 1000, 0);
}

describe('phone card lines (ROK-2155 report 1)', () => {
    it('puts a cardLine: own column on its own line, not in the meta line', () => {
        render(<HubMemberCards slice={slice([row()], OWN_LINE)} columns={OWN_LINE} rowClass={undefined} />);
        const card = screen.getByTestId('guild-member-row');
        const own = within(card).queryByTestId('guild-member-card-own-line');
        expect(own?.textContent, 'professions must sit on a third line of their own').toBe('Herbalism 300');
        expect(within(screen.getByTestId('guild-member-card-meta')).queryByTestId('cell-prof'), 'professions must leave the meta line').toBeNull();
        expect(within(screen.getByTestId('guild-member-card-meta')).getByTestId('cell-rank')).toHaveTextContent('Guild Master');
        expect(card.style.height, 'a three-line card is the derived 3-line height').toBe(`${cardRowHeight(3)}px`);
    });

    it('flags the WoW professions column for its own line, and sizes the WoW card from it', () => {
        expect(WOW_MEMBER_COLUMNS.find((c) => c.id === 'professions')?.cardLine).toBe('own');
        expect(cardMetrics(WOW_MEMBER_COLUMNS).row).toBe(90);
        expect(cardMetrics(NO_ROW_LINK), 'a hub with no own-line column keeps the two-line card').toBe(CARD_METRICS);
        expect(CARD_METRICS.row).toBe(64);
    });
});

describe('the windowed list counts the taller card (ROK-2155)', () => {
    const ROWS = Array.from({ length: 2000 }, (_, i) => row({ memberId: i, name: `Member ${i}` }));
    const originalHeight = window.innerHeight;
    beforeEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 }); });
    afterEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight }); });

    it('scrolling to row 1000 × the 3-line height mounts from row 1000 − overscan', () => {
        render(<HubMemberVirtualList bands={bandMembers(ROWS, undefined)} columns={OWN_LINE} rowClass={undefined} desktop={false} />);
        fireEvent.scroll(screen.getByTestId('guild-members-scroller'), { target: { scrollTop: 1000 * cardRowHeight(3) } });
        const first = screen.getAllByTestId('guild-member-row')[0];
        expect(first?.textContent, 'the window must be computed with the same height the cards draw').toBe(`Member ${1000 - OVERSCAN}Guild MasterHerbalism 300`);
    });
});

/** Shows the current path so a test can see where a row click went. */
function Where(): JSX.Element {
    return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderWowRow(r: GuildMemberRow, desktop: boolean, initial = '/hubs/7'): HTMLElement {
    const s = slice([r], WOW_MEMBER_COLUMNS);
    const Shell = desktop ? HubMemberTable : HubMemberCards;
    const shell = <Shell slice={s} columns={WOW_MEMBER_COLUMNS} rowClass={undefined} />;
    renderWithProviders(
        <><Routes><Route path="/hubs/:id" element={shell} /><Route path="/dev" element={shell} /><Route path="*" element={null} /></Routes><Where /></>,
        { initialEntries: [initial] },
    );
    return screen.getByTestId('guild-member-row');
}

const where = (): string | null => screen.getByTestId('where').textContent;

describe('whole-row click: phone cards stretch the name link (ROK-2155 report 2)', () => {
    it('a claimed card is one stretched link to its character page', () => {
        const el = renderWowRow(row({ characterId: LINKED }), false);
        const links = within(el).getAllByRole('link');
        expect(links, 'one link per row — no duplicate overlay anchor').toHaveLength(1);
        expect(links[0]).toHaveAttribute('href', `/characters/${LINKED}`);
        expect(links[0]?.className, 'the name link stretches over the card, border included').toContain('after:-inset-px');
        expect(el.className.split(' '), 'the card is the containing block of the overlay').toContain('relative');
        expect(el).not.toHaveAttribute('role', 'button');
    });

    it('an unclaimed card stretches its read-only roster-member link', () => {
        const el = renderWowRow(row({ characterId: null }), false);
        const links = within(el).getAllByRole('link');
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveAttribute('href', '/hubs/7/members/42');
        expect(links[0]?.className).toContain('after:-inset-px');
    });

    it('professions badges are raised only on the hover shell (lg:relative), so a card tap on them opens the row', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderWowRow(row({ characterId: MOCK_CHAR_IDS.thrall }), false);
        const classes = (await screen.findByTestId('guild-member-professions')).className.split(' ');
        expect(classes, 'titled badges stay hoverable above any overlay at lg').toContain('lg:relative');
        expect(classes, 'a bare relative would make the card\'s third line a tap dead zone').not.toContain('relative');
    });

    it('a hub kind without rowLink (community) gets no stretched link and no relative row', () => {
        expect(communityHubModule.memberColumns.some((c) => c.rowLink !== undefined), 'community rows are not clickable').toBe(false);
        renderWithProviders(<HubMemberCards slice={slice([row()], NO_ROW_LINK)} columns={NO_ROW_LINK} rowClass={undefined} />);
        const el = screen.getByTestId('guild-member-row');
        expect(within(el).getByRole('link').className, 'an un-opted link must not cover the row').not.toContain('after:');
        expect(el.className.split(' ')).not.toContain('relative');
    });
});

describe('whole-row click: the desktop table row is a mouse-only click (ROK-2155 review)', () => {
    it('clicking a non-link cell of a claimed row opens its character page; the link is not stretched', () => {
        const el = renderWowRow(row({ characterId: LINKED }), true);
        const links = within(el).getAllByRole('link');
        expect(links, 'one link per row, still the keyboard path').toHaveLength(1);
        expect(links[0]?.className, 'no ::after overlay on a table row').not.toContain('after:');
        expect(el.className.split(' '), 'a linked row looks clickable').toContain('cursor-pointer');
        expect(el).not.toHaveAttribute('tabindex');
        fireEvent.click(within(el).getByText('Guild Master'));
        expect(where(), 'a click on the Rank cell opens the row').toBe(`/characters/${LINKED}`);
    });

    it('clicking a non-link cell of an unclaimed row opens the roster-member page', () => {
        const el = renderWowRow(row({ characterId: null }), true);
        fireEvent.click(within(el).getByText('Guild Master'));
        expect(where()).toBe('/hubs/7/members/42');
    });

    it('a ctrl/cmd/shift-click or a middle click on the row body does not navigate', () => {
        const el = renderWowRow(row({ characterId: LINKED }), true);
        const rank = within(el).getByText('Guild Master');
        fireEvent.click(rank, { ctrlKey: true });
        fireEvent.click(rank, { metaKey: true });
        fireEvent.click(rank, { shiftKey: true });
        fireEvent.click(rank, { button: 1 });
        expect(where(), 'modified clicks are left to the name link').toBe('/hubs/7');
    });

    it('a click on a nested button or link inside the row is not hijacked by the row', () => {
        const ACTION: HubMemberColumn[] = [
            ...WOW_MEMBER_COLUMNS,
            { id: 'act', header: 'Act', cell: () => <><button type="button">Kick</button><span role="button">Ping</span><a href="#note">Note</a></> },
        ];
        renderWithProviders(
            <><Routes><Route path="/hubs/:id" element={<HubMemberTable slice={slice([row()], ACTION)} columns={ACTION} rowClass={undefined} />} /></Routes><Where /></>,
            { initialEntries: ['/hubs/7'] },
        );
        for (const name of ['Kick', 'Ping', 'Note']) fireEvent.click(screen.getByText(name));
        expect(where(), 'controls keep their own click').toBe('/hubs/7');
        fireEvent.click(screen.getByText('Guild Master'));
        expect(where(), 'the row body still opens the row').toBe('/hubs/7/members/42');
    });

    it('a row with no href (plain-text name, no /hubs/:id route) has no hover, no pointer and no click', () => {
        const el = renderWowRow(row({ characterId: null }), true, '/dev');
        expect(within(el).queryByRole('link'), 'the name is plain text').toBeNull();
        const classes = el.className.split(' ');
        expect(classes).not.toContain('cursor-pointer');
        expect(classes, 'hover must not promise a click that does nothing').not.toContain('hover:bg-panel');
        fireEvent.click(within(el).getByText('Guild Master'));
        expect(where()).toBe('/dev');
    });
});
