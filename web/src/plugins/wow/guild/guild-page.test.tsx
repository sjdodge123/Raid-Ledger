/**
 * ROK-1785: `/guilds/:id` — roster grouped by rank, S1's hidden tabs, the
 * friendly 403 state, and the Page editors card shown only to
 * `viewer.canManageEditors`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { GuildEditor, GuildMemberRow, GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { at } from '../../../test/defined';
import { renderWithProviders } from '../../../test/render-helpers';
import { GuildPage } from './guild-page';

const BASE = 'http://localhost:3000/plugins/wow/guilds/7';
const LINKED_ID = '3f6c1a52-8a3b-4c0e-9d2f-1b2c3d4e5f60';

function row(overrides: Partial<GuildMemberRow> & Pick<GuildMemberRow, 'memberId' | 'name'>): GuildMemberRow {
    return { class: 'Warrior', level: 60, rankIndex: 2, rankName: 'Raider', effectiveRole: null, characterId: null, isMain: false, ...overrides };
}

function makePage(canManageEditors = false): GuildPageDto {
    return {
        guild: { id: 7, gameId: 1, name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 3, lastSnapshotAt: null },
        importedBy: null,
        viewer: { canEdit: canManageEditors, canManageEditors },
        ranks: [
            { rankIndex: 0, rankName: 'Guild Master', members: [row({ memberId: 1, name: 'Grimtusk', rankIndex: 0, rankName: 'Guild Master', effectiveRole: 'tank', characterId: LINKED_ID, isMain: true })] },
            { rankIndex: 2, rankName: 'Raider', members: [row({ memberId: 2, name: 'Stormcall', effectiveRole: 'healer', characterId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }), row({ memberId: 3, name: 'Nolinkadin' })] },
        ],
        // Deliberately NOT what the roster rows would tally (1/1/0): the UI must show the server's per-user counts.
        roleCounts: { tank: 2, healer: 4, dps: 7, unknown: 1 },
    };
}

const RANK_EDITOR: GuildEditor = {
    id: 11, guildId: 7, kind: 'rank', rankIndex: 2, rankName: 'Raider', guildMemberId: null, memberName: null, grantedBy: 'Grimtusk', createdAt: '2026-10-14T10:00:00.000Z',
};

let editorCalls = 0;
let posts: unknown[] = [];

function serve(page: GuildPageDto | null, status = 200, editors: GuildEditor[] = [RANK_EDITOR]): void {
    server.use(
        http.get(BASE, () => (page ? HttpResponse.json(page) : HttpResponse.json({ message: 'Forbidden' }, { status }))),
        http.get(`${BASE}/editors`, () => { editorCalls += 1; return HttpResponse.json({ editors }); }),
        http.post(`${BASE}/editors`, async ({ request }) => {
            posts.push(await request.json());
            return HttpResponse.json({ ...RANK_EDITOR, id: 12, kind: 'member', rankIndex: null, rankName: null, guildMemberId: 3, memberName: 'Nolinkadin' });
        }),
    );
}

function renderPage(): void {
    renderWithProviders(<Routes><Route path="/guilds/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/guilds/7'] });
}

beforeEach(() => { editorCalls = 0; posts = []; });
afterEach(() => { window.location.hash = ''; });

describe('GuildPage (ROK-1785)', () => {
    it('shows only the Overview and Roster tabs in S1', async () => {
        serve(makePage());
        renderPage();
        const nav = await screen.findByRole('navigation', { name: 'Guild page sections' });
        const labels = within(nav).getAllByRole('link').map((a) => a.textContent);
        expect(labels).toEqual(['Overview', 'Roster']);
    });

    it('the hero shows the addon-reported realm for a realm-less (Forever) guild', async () => {
        serve(makePage());
        renderPage();
        const hero = await screen.findByTestId('guild-hero');
        expect(hero, 'a realm-less guild with raw_realm must still show its realm').toHaveTextContent('Doomhowl · US');
    });

    it('renders the roster grouped by rank, linking only RL characters', async () => {
        window.location.hash = '#roster';
        serve(makePage());
        renderPage();
        const gm = await screen.findByTestId('guild-rank-0');
        expect(within(gm).getByRole('link', { name: 'Grimtusk' })).toHaveAttribute('href', `/characters/${LINKED_ID}`);
        const raiders = screen.getByTestId('guild-rank-2');
        expect(within(raiders).getByText('Raider · 2')).toBeInTheDocument();
        expect(within(raiders).queryByRole('link', { name: 'Nolinkadin' })).toBeNull();
        expect(within(raiders).getByTestId('guild-member-unlinked')).toHaveTextContent('Nolinkadin');
    });

    it('shows the server role counts (one per user) in the Overview summary with a #roster jump', async () => {
        serve(makePage());
        renderPage();
        const summary = await screen.findByTestId('guild-members-summary');
        expect(within(summary).getByTestId('guild-role-count-tank')).toHaveTextContent('2Tank');
        expect(within(summary).getByTestId('guild-role-count-healer')).toHaveTextContent('4Heal');
        expect(within(summary).getByTestId('guild-role-count-dps')).toHaveTextContent('7DPS');
        expect(screen.getByTestId('guild-see-roster')).toHaveAttribute('href', '#roster');
    });

    it('shows the friendly not-a-member state on a 403', async () => {
        serve(null, 403);
        renderPage();
        await waitFor(() => expect(screen.queryByTestId('guild-loading')).toBeNull());
        expect(screen.queryByTestId('guild-error'), 'a 403 must not render the generic error state').toBeNull();
        expect(screen.getByTestId('guild-not-member')).toHaveTextContent("You're not a member of this guild.");
        expect(screen.queryByTestId('guild-hero')).toBeNull();
    });

    it('hides the Page editors card unless the viewer can manage editors', async () => {
        serve(makePage(false));
        renderPage();
        await screen.findByTestId('guild-members-summary');
        expect(screen.queryByTestId('guild-editors-panel')).toBeNull();
        expect(editorCalls).toBe(0);
    });

    it('lists editors and adds a member for a viewer who can manage editors', async () => {
        serve(makePage(true));
        renderPage();
        const panel = await screen.findByTestId('guild-editors-panel');
        await userEvent.click(within(panel).getByText('Page editors'));
        expect(await within(panel).findByTestId('guild-editor-chip')).toHaveTextContent('Rank: Raider');
        expect(within(panel).getByTestId('guild-editors-gm-hint')).toHaveTextContent('Add your Guild Master as an editor.');
        const memberSelect = within(panel).getByTestId('guild-editor-member-select');
        expect(within(memberSelect).getByRole('option', { name: /Grimtusk/ }), 'the GM must be grantable as a member').toHaveValue('1');
        const rankOptions = within(within(panel).getByTestId('guild-editor-rank-select')).getAllByRole('option');
        expect(rankOptions.map((o) => o.textContent)).toEqual(['Pick one…']);
        await userEvent.selectOptions(within(panel).getByTestId('guild-editor-member-select'), '3');
        await userEvent.click(at(within(panel).getAllByRole('button', { name: 'Add editor' }), 1));
        await waitFor(() => expect(posts).toEqual([{ kind: 'member', guildMemberId: 3 }]));
    });

    it('drops the "add your Guild Master" hint once the GM (rank 0) holds a member grant', async () => {
        const gmGrant: GuildEditor = { ...RANK_EDITOR, id: 13, kind: 'member', rankIndex: null, rankName: null, guildMemberId: 1, memberName: 'Grimtusk' };
        serve(makePage(true), 200, [RANK_EDITOR, gmGrant]);
        renderPage();
        const panel = await screen.findByTestId('guild-editors-panel');
        await userEvent.click(within(panel).getByText('Page editors'));
        await waitFor(() => expect(within(panel).getAllByTestId('guild-editor-chip')).toHaveLength(2));
        expect(within(panel).queryByTestId('guild-editors-gm-hint'), 'the GM is already an editor, so the hint must hide').toBeNull();
    });
});
