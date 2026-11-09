/**
 * ROK-2155 — the Members row on a phone: (1) a `cardLine: 'own'` column
 * (WoW professions) gets a third line of its own instead of being crammed
 * into the meta line, and the windowed list counts the taller card; (2) a hub
 * kind whose column sets `rowLink` makes the whole row open that column's ONE
 * link (stretched `::after`), on the phone cards and the desktop table alike.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { GuildMemberRow } from '@raid-ledger/contract';
import type { HubMemberColumn } from '../../plugins/hub-module';
import { renderWithProviders } from '../../test/render-helpers';
import { WOW_MEMBER_COLUMNS } from '../../plugins/wow/hub/wow-members.helpers';
import { communityHubModule } from './community/community-hub-module';
import { CharacterLink } from './character-link';
import { bandMembers } from './hub-members.helpers';
import { HubMemberCards, HubMemberTable } from './hub-member-table';
import { HubMemberVirtualList, OVERSCAN } from './hub-member-virtual-list';
import { CARD_METRICS, cardMetrics, cardRowHeight, virtualSlice } from './hub-member-virtual.helpers';

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

function renderWowRow(r: GuildMemberRow, desktop: boolean): HTMLElement {
    const s = slice([r], WOW_MEMBER_COLUMNS);
    const Shell = desktop ? HubMemberTable : HubMemberCards;
    renderWithProviders(
        <Routes><Route path="/hubs/:id" element={<Shell slice={s} columns={WOW_MEMBER_COLUMNS} rowClass={undefined} />} /></Routes>,
        { initialEntries: ['/hubs/7'] },
    );
    return screen.getByTestId('guild-member-row');
}

describe('whole-row click (ROK-2155 report 2)', () => {
    for (const desktop of [false, true]) {
        const shell = desktop ? 'desktop table' : 'phone card';
        it(`${shell}: a claimed row is one stretched link to its character page`, () => {
            const el = renderWowRow(row({ characterId: LINKED }), desktop);
            const links = within(el).getAllByRole('link');
            expect(links, 'one link per row — no duplicate overlay anchor').toHaveLength(1);
            expect(links[0]).toHaveAttribute('href', `/characters/${LINKED}`);
            expect(links[0]?.className, 'the name link stretches over the row').toContain('after:inset-0');
            expect(el.className, 'the row is the containing block of the overlay').toContain('relative');
            expect(el).not.toHaveAttribute('role', 'button');
        });

        it(`${shell}: an unclaimed row stretches its read-only roster-member link`, () => {
            const el = renderWowRow(row({ characterId: null }), desktop);
            const links = within(el).getAllByRole('link');
            expect(links).toHaveLength(1);
            expect(links[0]).toHaveAttribute('href', '/hubs/7/members/42');
            expect(links[0]?.className).toContain('after:inset-0');
        });
    }

    it('a hub kind without rowLink (community) gets no stretched link and no relative row', () => {
        expect(communityHubModule.memberColumns.some((c) => c.rowLink === true), 'community rows are not clickable').toBe(false);
        renderWithProviders(<HubMemberCards slice={slice([row()], NO_ROW_LINK)} columns={NO_ROW_LINK} rowClass={undefined} />);
        const el = screen.getByTestId('guild-member-row');
        expect(within(el).getByRole('link').className, 'an un-opted link must not cover the row').not.toContain('after:inset-0');
        expect(el.className.split(' ')).not.toContain('relative');
    });
});
