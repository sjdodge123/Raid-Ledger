/**
 * ROK-2147 — the character page's guild addons card with the character's
 * installed addons: Installed / Missing per recommendation (case-insensitive
 * folder match), a highlighted missing Required row, "Also installed" capped
 * at 5, the source line — and, for anyone not allowed to see the list, the
 * card exactly as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { CharacterInstalledAddonsResponse } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    guildAddonFixture, installedAddon, NOT_VISIBLE, serveInstalledAddons, VISIBLE_NO_EXPORT, visibleInstalled,
} from '../../../test/mocks/installed-addons-handlers';
import { CharacterAddonsCard } from './character-addons-card';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000/plugins/wow/guilds';
const CHAR_ID = '5b3c6f3e-1d2a-4c9b-9a51-2f8e7d6c5b4a';
const SUMMARY = { id: 11, gameId: 7, kind: 'wow_guild' as const, name: 'Iron Vanguard', region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde', memberCount: 12, lastSnapshotAt: null };
const PINNED = { name: 'LedgerLink', url: 'https://github.com/sjdodge123/ledger-link', note: null, requirement: 'required' as const, flavors: [], folderName: 'LedgerLink' };
const GUILD_ADDONS = [
    guildAddonFixture(1, { displayName: 'Deadly Boss Mods', requirement: 'required', folderName: 'DBM-Core' }),
    guildAddonFixture(2, { displayName: 'Details', requirement: 'optional', folderName: 'Details' }),
    guildAddonFixture(3, { displayName: 'Questie', requirement: 'optional', folderName: null }),
];
const EXTRAS = ['Bagnon', 'Auctionator', 'Questie', 'Leatrix', 'OmniCC', 'WeakAuras'].map((n) => installedAddon(n));

function serve(installed: CharacterInstalledAddonsResponse | number): void {
    server.use(
        http.get(`${API}/by-character/${CHAR_ID}`, () => HttpResponse.json({ data: { guild: SUMMARY, rankName: 'Raider', viewerCanOpen: true } })),
        http.get(`${API}/11/addons`, () => HttpResponse.json({ pinned: [PINNED], addons: GUILD_ADDONS })),
        serveInstalledAddons(installed),
    );
}

async function renderCard(installed: CharacterInstalledAddonsResponse | number): Promise<HTMLElement> {
    serve(installed);
    renderWithProviders(<CharacterAddonsCard characterId={CHAR_ID} />);
    return screen.findByTestId('character-guild-addons');
}

function row(card: HTMLElement, name: string): HTMLElement {
    const el = within(card).getByText(name).closest('li');
    if (!el) throw new Error(`no row for ${name}`);
    return el;
}

describe('CharacterAddonsCard — owner / officer view', () => {
    it('marks each recommendation with a folder name Installed or Missing, case-insensitive', async () => {
        const card = await renderCard(visibleInstalled([installedAddon('ledgerlink'), installedAddon('details', { loaded: false })]));
        expect(row(card, 'LedgerLink'), 'lower-case folder still matches').toHaveAttribute('data-install-state', 'installed');
        expect(within(row(card, 'LedgerLink')).getByText('Installed')).toBeInTheDocument();
        expect(row(card, 'Details')).toHaveAttribute('data-install-state', 'installed');
        expect(row(card, 'Deadly Boss Mods')).toHaveAttribute('data-install-state', 'missing');
        expect(row(card, 'Questie'), 'no folder name = no state').not.toHaveAttribute('data-install-state');
        expect(within(row(card, 'Questie')).queryByText(/Installed|Missing/)).toBeNull();
    });

    it('highlights a missing Required row and leaves a missing optional one plain', async () => {
        const card = await renderCard(visibleInstalled([installedAddon('LedgerLink')]));
        const dbm = row(card, 'Deadly Boss Mods');
        expect(dbm.className, 'missing Required row is tinted').toContain('border-l-warning');
        expect(within(dbm).getByText('Missing')).toHaveAttribute('data-tone', 'warning');
        expect(within(dbm).getByText('Required'), 'the Required pill stays').toBeInTheDocument();
        const details = row(card, 'Details');
        expect(details.className, 'missing optional row is not tinted').not.toContain('border-l-warning');
        expect(within(details).getByText('Missing')).toHaveAttribute('data-tone', 'neutral');
    });

    it('lists unclaimed folders under "Also installed", capped at 5 with Show all', async () => {
        const card = await renderCard(visibleInstalled([installedAddon('LedgerLink'), ...EXTRAS]));
        const also = within(card).getByTestId('character-also-installed');
        expect(within(also).getByRole('heading', { name: 'Also installed (6)' })).toBeInTheDocument();
        expect(within(also).getAllByRole('listitem')).toHaveLength(5);
        await userEvent.click(within(also).getByRole('button', { name: 'Show all 6' }));
        expect(within(also).getAllByRole('listitem')).toHaveLength(6);
        expect(within(also).queryByText('LedgerLink'), 'a matched folder is not repeated').toBeNull();
    });

    it('shows the "via addon · <date>" source line', async () => {
        const card = await renderCard(visibleInstalled([installedAddon('LedgerLink')]));
        expect(within(card).getByTestId('character-installed-source')).toHaveTextContent('via addon · 1 Nov 2026');
        expect(within(card).queryByTestId('character-also-installed'), 'no unclaimed folders = no section').toBeNull();
    });
});

describe('CharacterAddonsCard — everyone else sees the card unchanged', () => {
    it.each([
        ['not visible', NOT_VISIBLE],
        ['visible but no export yet', VISIBLE_NO_EXPORT],
        ['403 from the endpoint', 403],
    ] as const)('%s: no state pills, no source line, no Also installed', async (_label, reply) => {
        const card = await renderCard(reply);
        expect(card.querySelector('[data-install-state]'), 'no row carries an install state').toBeNull();
        expect(within(card).queryByText(/^(Installed|Missing)$/)).toBeNull();
        expect(within(card).queryByTestId('character-installed-source')).toBeNull();
        expect(within(card).queryByTestId('character-also-installed')).toBeNull();
        expect(within(card).getAllByRole('listitem'), 'all four recommendations still listed').toHaveLength(4);
    });
});
