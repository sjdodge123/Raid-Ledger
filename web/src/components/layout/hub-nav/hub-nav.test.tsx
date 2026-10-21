/**
 * ROK-1785 entry E, core since ROK-1870 D9: the drawer "Your hub(s)" block
 * reads core `GET /guilds/mine` with no plugin active. (The header's old
 * "Guild" link became the Hubs menu in ROK-1875 — see hubs-nav-menu.test.tsx.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { DrawerYourGuild } from './drawer-your-guild';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000/plugins/wow/guilds';

function guild(id: number, name: string, memberCount = 12): MyGuild {
    return {
        id, gameId: 7, kind: 'wow_guild', name, region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde',
        memberCount, lastSnapshotAt: null, rankIndex: 2, rankName: 'Raider', canEdit: false, gmPostHeadline: null,
    };
}
const ONE = [guild(11, 'Iron Vanguard')];
const TWO = [guild(11, 'Iron Vanguard'), guild(12, 'Dusk Wardens', 1)];

function serve(guilds: MyGuild[]): void {
    server.use(
        http.get(`http://localhost:3000/guilds/mine`, () => HttpResponse.json({ guilds })),
        http.get(API, () => HttpResponse.json({ guilds })),
    );
}

/** Wait until the guild query settled, then assert the filler stayed empty. */
async function expectEmpty(container: HTMLElement, path: string): Promise<void> {
    let hit = false;
    server.events.on('response:mocked', ({ request }) => { if (request.url.includes(path)) hit = true; });
    await waitFor(() => expect(hit, `expected a request to ${path}`).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
}

beforeEach(() => { server.events.removeAllListeners(); });

describe('DrawerYourGuild (nav:drawer-top)', () => {
    it('one guild → "Your guild"; tapping it closes the drawer', async () => {
        serve(ONE);
        const onClose = vi.fn();
        renderWithProviders(<DrawerYourGuild onClose={onClose} />);
        expect(await screen.findByTestId('drawer-your-guild')).toHaveTextContent('Your hub');
        await userEvent.click(screen.getByTestId('guild-entry-row'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('two hubs → "Your hubs" with both rows', async () => {
        serve(TWO);
        renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        expect(await screen.findByText('Your hubs')).toBeInTheDocument();
        expect(screen.getAllByTestId('guild-entry-row')).toHaveLength(2);
    });

    it('no guild → nothing', async () => {
        serve([]);
        const { container } = renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        await expectEmpty(container, '/guilds/mine');
    });
});

describe('kind chips in the drawer rows (ROK-1875 D5/D6)', () => {
    it('a WoW guild row carries a "Guild" chip and keeps its rank · realm · region', async () => {
        serve(ONE);
        renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        const row = await screen.findByTestId('guild-entry-row');
        expect(row).toHaveTextContent('Raider · Whitemane · US');
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Guild');
    });

    it('a community hub row: the chip says "Community"; the meta no longer repeats it nor shows a realm or region', async () => {
        server.use(http.get('http://localhost:3000/guilds/mine', () => HttpResponse.json({ guilds: [
            { ...guild(21, 'BG3 Crew'), kind: 'game_community', region: 'community', realmSlug: null, rankName: null },
        ] })));
        renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        const row = await screen.findByTestId('guild-entry-row');
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Community');
        expect(row).not.toHaveTextContent('Community hub');
        expect(row).not.toHaveTextContent('COMMUNITY');
    });

    it('a server hub row says "Server" once — the chip only, no SERVER meta line (operator 2026-10-21)', async () => {
        server.use(http.get('http://localhost:3000/guilds/mine', () => HttpResponse.json({ guilds: [
            { ...guild(22, 'Valheim — Gamernight'), kind: 'game_server', region: 'server', realmSlug: null, rankName: null },
        ] })));
        renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        const row = await screen.findByTestId('guild-entry-row');
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Server');
        expect(row).not.toHaveTextContent('SERVER');
    });
});
