/**
 * ROK-2172 — the role chips filter the Members list. Driven through the real
 * `GuildPage` + WoW hub module: the Overview pill opens Members filtered to
 * exactly that role, the Members band toggles the same Role filter the
 * Filters panel shows, and "See members" opens the unfiltered list.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { CharacterRole, GuildMemberRow, GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { GuildPage } from '../../../components/hub/hub-page';

const BASE = 'http://localhost:3000/guilds/7';

function row(memberId: number, name: string, effectiveRole: CharacterRole): GuildMemberRow {
    return { memberId, name, class: 'Warrior', level: 60, rankIndex: 0, rankName: 'Raider', effectiveRole, characterId: null, isMain: false };
}

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: 'doomhowl', realmName: 'Doomhowl', faction: 'Horde', memberCount: 3, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [{ rankIndex: 0, rankName: 'Raider', members: [row(1, 'Grimtusk', 'tank'), row(2, 'Stormcall', 'healer'), row(3, 'Nolina', 'dps')] }],
    roleCounts: { tank: 1, healer: 1, dps: 1, unknown: 0 },
};

const originalMatchMedia = window.matchMedia;
function mockDesktop(): void {
    window.matchMedia = (query: string) => ({
        matches: query === DESKTOP_MQ, media: query, onchange: null,
        addListener: () => undefined, removeListener: () => undefined,
        addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    });
}

function renderPage(hash: string, page: GuildPageDto = PAGE): void {
    window.location.hash = hash;
    server.use(http.get(BASE, () => HttpResponse.json(page)));
    renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'] });
}

function listedNames(): string[] {
    return screen.getAllByTestId('guild-member-row').map((el) => el.firstElementChild?.textContent ?? '');
}

/** The Members band pill for `label` ("Tank" / "Heal" / "DPS"). */
function bandPill(label: string): HTMLElement {
    return screen.getByRole('button', { name: `Show 1 ${label} members` });
}

/** The Filters panel's Role chip (opens the inline panel first). */
async function roleChip(label: string): Promise<HTMLElement> {
    if (!screen.queryByTestId('wow-filter-role')) await userEvent.click(screen.getByTestId('filter-panel-trigger'));
    return within(screen.getByTestId('wow-filter-role')).getByRole('button', { name: label });
}

beforeEach(() => { activateWowPlugin(); mockDesktop(); });
afterEach(() => { window.location.hash = ''; window.matchMedia = originalMatchMedia; });

describe('Role chips filter the Members list (ROK-2172)', () => {
    it('an Overview pill opens Members filtered to exactly that role', async () => {
        renderPage('');
        const link = await screen.findByRole('link', { name: 'Show 1 Tank members' });
        expect(link, 'the Overview pill is a plain hash link').toHaveAttribute('href', '#members?role=tank');
        await userEvent.click(link);
        await waitFor(() => expect(bandPill('Tank'), 'the band shows the chosen role pressed').toHaveAttribute('aria-pressed', 'true'));
        expect(window.location.hash, 'the role survives a reload of this URL').toBe('#members?role=tank');
        expect(bandPill('Heal')).toHaveAttribute('aria-pressed', 'false');
        expect(listedNames(), 'only the tank is listed').toEqual(['Grimtusk']);
        expect(await roleChip('Tank'), 'the Filters panel shows the same Role filter').toHaveAttribute('aria-pressed', 'true');
        expect(await roleChip('Healer')).toHaveAttribute('aria-pressed', 'false');
    });

    it('a Members band pill toggles the Role filter, and the Role chips share its state', async () => {
        renderPage('#members');
        await screen.findByTestId('guild-members');
        expect(bandPill('Tank')).toHaveAttribute('aria-pressed', 'false');
        await userEvent.click(bandPill('Tank'));
        expect(bandPill('Tank'), 'one click presses the pill').toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(listedNames()).toEqual(['Grimtusk']));
        expect(window.location.hash).toBe('#members?role=tank');
        expect(await roleChip('Tank'), 'the panel chip reflects the band click').toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(await roleChip('Healer'));
        expect(bandPill('Heal'), 'the band reflects the panel chip').toHaveAttribute('aria-pressed', 'true');
        expect(window.location.hash, 'two roles are not a single-role link').toBe('#members');
        await userEvent.click(bandPill('Tank'));
        await userEvent.click(bandPill('Heal'));
        expect(bandPill('Tank'), 'a second click clears the role').toHaveAttribute('aria-pressed', 'false');
        await waitFor(() => expect(listedNames()).toEqual(['Grimtusk', 'Stormcall', 'Nolina']));
    });

    it('"See members" opens the unfiltered list after a role chip was used', async () => {
        renderPage('#members?role=tank');
        await waitFor(() => expect(bandPill('Tank')).toHaveAttribute('aria-pressed', 'true'));
        const nav = screen.getByRole('navigation', { name: 'Guild page sections' });
        await userEvent.click(within(nav).getByRole('link', { name: 'Overview' }));
        await userEvent.click(await screen.findByTestId('guild-see-members'));
        await waitFor(() => expect(bandPill('Tank'), '"See members" clears the role').toHaveAttribute('aria-pressed', 'false'));
        expect(listedNames()).toEqual(['Grimtusk', 'Stormcall', 'Nolina']);
        expect(window.location.hash).toBe('#members');
    });

});

describe('Role filter follows the hash while Members is mounted (ROK-2172)', () => {
    it('the Members tab (plain #members) clears a role while Members is mounted', async () => {
        renderPage('#members?role=tank');
        await waitFor(() => expect(bandPill('Tank')).toHaveAttribute('aria-pressed', 'true'));
        const nav = screen.getByRole('navigation', { name: 'Guild page sections' });
        await userEvent.click(within(nav).getByRole('link', { name: 'Members' }));
        await waitFor(() => expect(bandPill('Tank'), 'a hashchange to plain #members clears the role').toHaveAttribute('aria-pressed', 'false'));
        expect(listedNames()).toEqual(['Grimtusk', 'Stormcall', 'Nolina']);
        expect(window.location.hash).toBe('#members');
    });

    it('Back/Forward (popstate) and a hand-edited ?role= re-apply the hash role while Members is mounted', async () => {
        renderPage('#members');
        await screen.findByTestId('guild-members');
        window.history.replaceState(window.history.state, '', '#members?role=healer');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await waitFor(() => expect(bandPill('Heal'), 'popstate re-applies the hash role').toHaveAttribute('aria-pressed', 'true'));
        expect(listedNames()).toEqual(['Stormcall']);
        window.location.hash = '#members?role=dps';
        await waitFor(() => expect(bandPill('DPS'), 'a hand-edited ?role= re-applies').toHaveAttribute('aria-pressed', 'true'));
        expect(bandPill('Heal'), 'the hash role replaces the previous one').toHaveAttribute('aria-pressed', 'false');
        expect(window.location.hash).toBe('#members?role=dps');
    });
});

/** A visitor's view of a members-first hub: role counts, but no member rows. */
const VISITOR_PAGE: GuildPageDto = { ...PAGE, ranks: [] };

describe('Role pills for a viewer with no member rows (ROK-2172)', () => {
    it('the Overview pills are read-only: no link to an empty list', async () => {
        renderPage('', VISITOR_PAGE);
        await screen.findByTestId('guild-members-summary');
        expect(screen.getByTestId('guild-role-count-tank')).toHaveTextContent('1Tank');
        expect(screen.queryByRole('link', { name: /^Show \d+ .* members$/ }), 'a visitor gets no role-filter links').toBeNull();
    });

    it('the Members band is read-only: no toggles over zero rows', async () => {
        renderPage('#members', VISITOR_PAGE);
        await screen.findByTestId('guild-members');
        expect(screen.getByTestId('guild-role-count-healer')).toHaveTextContent('1Heal');
        expect(screen.queryByRole('button', { name: /^Show \d+ .* members$/ }), 'a visitor gets no role toggles').toBeNull();
    });
});
