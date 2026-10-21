/**
 * ROK-1875 (operator ruling 2026-10-20) — the header "Hubs" item: a plain link
 * to /hubs while the viewer has no hubs (or the list is loading / failed), a
 * §4.14 menu ("Your hubs" with a kind chip per row + "Browse all hubs") once
 * they have one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import type { GuildKind, MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { HubsNavItem } from './hubs-nav-menu';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const MINE = 'http://localhost:3000/guilds/mine';

function hub(id: number, name: string, kind: GuildKind): MyGuild {
    return {
        id, gameId: 7, kind, name, region: kind === 'game_community' ? 'community' : 'us', realmSlug: null, realmName: null,
        faction: null, memberCount: 3, lastSnapshotAt: null, rankIndex: null, rankName: null, canEdit: false, gmPostHeadline: null,
    };
}
const TWO = [hub(31, 'Valheim — Gamernight', 'game_server'), hub(21, 'BG3 Crew', 'game_community')];

function serve(guilds: MyGuild[]): void {
    server.use(http.get(MINE, () => HttpResponse.json({ guilds })));
}

/** Resolves once the `/guilds/mine` request has been answered. */
function settled(): Promise<void> {
    return new Promise((resolve) => {
        server.events.on('response:mocked', ({ request }) => { if (request.url.includes('/guilds/mine')) resolve(); });
    });
}

async function openMenu(pathname = '/players'): Promise<HTMLElement> {
    renderWithProviders(<HubsNavItem pathname={pathname} />);
    await userEvent.click(await screen.findByTestId('nav-hubs-menu-trigger'));
    return screen.getByRole('menu', { name: 'Hubs' });
}

beforeEach(() => { server.events.removeAllListeners(); });

describe('HubsNavItem — the plain-link fallback (D1)', () => {
    it('no hubs → a plain "Hubs" link to /hubs and no menu trigger', async () => {
        serve([]);
        const done = settled();
        renderWithProviders(<HubsNavItem pathname="/players" />);
        await done;
        await waitFor(() => expect(screen.getByTestId('nav-hubs-link')).toHaveAttribute('href', '/hubs'));
        expect(screen.queryByTestId('nav-hubs-menu-trigger')).not.toBeInTheDocument();
    });

    it('while the list is loading → the plain link (the item never flashes away)', () => {
        server.use(http.get(MINE, async () => { await delay('infinite'); return HttpResponse.json({ guilds: [] }); }));
        renderWithProviders(<HubsNavItem pathname="/players" />);
        expect(screen.getByTestId('nav-hubs-link')).toHaveAttribute('href', '/hubs');
    });

    it('a failed list → the plain link', async () => {
        server.use(http.get(MINE, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const done = settled();
        renderWithProviders(<HubsNavItem pathname="/players" />);
        await done;
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.getByTestId('nav-hubs-link')).toHaveAttribute('href', '/hubs');
        expect(screen.queryByTestId('nav-hubs-menu-trigger')).not.toBeInTheDocument();
    });

    it('the plain link is current on /hubs', async () => {
        serve([]);
        renderWithProviders(<HubsNavItem pathname="/hubs" />);
        const link = screen.getByTestId('nav-hubs-link');
        expect(link).toHaveAttribute('aria-current', 'page');
        expect(link.className).toContain('text-emerald-400');
    });
});

describe('HubsNavItem — the menu (D7)', () => {
    it('lists every hub in API order with its kind chip, then "Browse all hubs" → /hubs', async () => {
        serve(TWO);
        const menu = await openMenu();
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        expect(items.map((a) => a.getAttribute('href'))).toEqual(['/guilds/31', '/guilds/21', '/hubs']);
        expect(screen.getAllByTestId('hub-kind-chip').map((c) => c.textContent)).toEqual(['Server', 'Community']);
        expect(menu).toHaveTextContent('Your hubs');
        expect(screen.getByTestId('nav-hubs-browse-all')).toHaveTextContent('Browse all hubs');
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('a WoW guild row reads "Guild"', async () => {
        serve([hub(11, 'Iron Vanguard', 'wow_guild')]);
        await openMenu();
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Guild');
        expect(screen.getByTitle('Guild hub')).toHaveTextContent('Guild');
    });

    it('the trigger announces a menu and lights on any hub page', async () => {
        serve(TWO);
        renderWithProviders(<HubsNavItem pathname="/guilds/31" />);
        const trigger = await screen.findByTestId('nav-hubs-menu-trigger');
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveAttribute('aria-current', 'page');
        await userEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('menu').id);
    });

    it('clicking a row closes the menu', async () => {
        serve(TWO);
        await openMenu();
        await userEvent.click(screen.getAllByRole('menuitem')[0] ?? document.body);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('an outside mousedown closes the menu', async () => {
        serve(TWO);
        await openMenu();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});

describe('HubsNavItem — keyboard (§4.14)', () => {
    async function openWithKeys(): Promise<HTMLElement[]> {
        serve(TWO);
        await openMenu();
        return screen.getAllByRole('menuitem');
    }

    it('opening focuses the first item; ArrowUp from the first wraps to "Browse all hubs"', async () => {
        const items = await openWithKeys();
        await waitFor(() => expect(document.activeElement).toBe(items[0]));
        await userEvent.keyboard('{ArrowUp}');
        expect(document.activeElement).toBe(screen.getByTestId('nav-hubs-browse-all'));
        await userEvent.keyboard('{ArrowDown}');
        expect(document.activeElement).toBe(items[0]);
        await userEvent.keyboard('{End}');
        expect(document.activeElement).toBe(items[2]);
        await userEvent.keyboard('{Home}');
        expect(document.activeElement).toBe(items[0]);
    });

    it('Escape closes and returns focus to the trigger', async () => {
        await openWithKeys();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(screen.getByTestId('nav-hubs-menu-trigger'));
    });

    it('Tab closes the menu', async () => {
        await openWithKeys();
        await userEvent.keyboard('{Tab}');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});
