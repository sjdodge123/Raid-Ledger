/**
 * ROK-1785 entry E, core since ROK-1870 D9: the header "Guild" link and the
 * drawer "Your guild" block read core `GET /guilds/mine` with no plugin active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { NavGuildLink } from './nav-guild-link';
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

describe('NavGuildLink (nav:primary-links)', () => {
    it('one guild → a "Guild" link to its page, active on that page', async () => {
        serve(ONE);
        renderWithProviders(<NavGuildLink pathname="/guilds/11" />);
        const link = await screen.findByTestId('nav-guild-link');
        expect(link).toHaveAttribute('href', '/guilds/11');
        expect(link).toHaveTextContent('Guild');
        expect(link.className).toContain('text-emerald-400');
    });

    it('two guilds → a menu listing both', async () => {
        serve(TWO);
        renderWithProviders(<NavGuildLink pathname="/players" />);
        await userEvent.click(await screen.findByTestId('nav-guild-menu-trigger'));
        const menu = screen.getByTestId('nav-guild-menu');
        expect(menu).toHaveTextContent('Iron Vanguard');
        expect(menu).toHaveTextContent('Dusk Wardens');
        expect(screen.getAllByTestId('guild-entry-row').map((a) => a.getAttribute('href'))).toEqual(['/guilds/11', '/guilds/12']);
    });

    it('no guild → nothing', async () => {
        serve([]);
        const { container } = renderWithProviders(<NavGuildLink pathname="/" />);
        await expectEmpty(container, '/guilds/mine');
    });
});

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

describe('community hubs in the nav (ROK-1870)', () => {
    it('a community hub row reads "Community hub", not a realm or region', async () => {
        server.use(http.get('http://localhost:3000/guilds/mine', () => HttpResponse.json({ guilds: [
            { ...guild(21, 'BG3 Crew'), kind: 'game_community', region: 'community', realmSlug: null, rankName: null },
        ] })));
        renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        expect(await screen.findByTestId('guild-entry-row')).toHaveTextContent('Community hub');
        expect(screen.getByTestId('guild-entry-row')).not.toHaveTextContent('COMMUNITY');
    });
});
