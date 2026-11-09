/**
 * ROK-1875 (operator ruling 2026-10-20) — the header "Hubs" item: a plain link
 * to /hubs while the viewer has no hubs (or the list is loading / failed), a
 * §4.14 menu ("Your hubs" with a kind chip per row + "Browse all hubs") once
 * they have one. ROK-2152: the menu also lists up to 5 "Popular hubs" the
 * viewer is not in, and a viewer with no hubs gets the menu (popular only)
 * once there is one to suggest (Q1).
 */
import type { JSX } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { useLocation } from 'react-router-dom';
import type { GuildKind, HubDirectoryEntry, MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { createMockHubDirectoryPage, createMockHubEntry } from '../../../test/handlers/community-hubs';
import { HubsNavItem } from './hubs-nav-menu';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
    // The real useViewerCacheScope calls the module-internal useAuth, which the mock above does not reach.
    useViewerCacheScope: () => 1,
}));

const MINE = 'http://localhost:3000/guilds/mine';
const DIRECTORY = 'http://localhost:3000/hubs';

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

/** ROK-2152: the `GET /hubs?membership=not-joined…` answer behind "Popular hubs". */
function servePopular(items: HubDirectoryEntry[]): void {
    server.use(http.get(DIRECTORY, () => HttpResponse.json(createMockHubDirectoryPage({ items }))));
}

const popular = (n: number): HubDirectoryEntry[] =>
    Array.from({ length: n }, (_, i) => createMockHubEntry({ id: 501 + i, name: `Popular ${i + 1}`, memberCount: 20 - i }));

/** Resolves once the popular-hubs directory request has been answered. */
function popularSettled(): Promise<void> {
    return new Promise((resolve) => {
        server.events.on('response:mocked', ({ request }) => { if (new URL(request.url).pathname === '/hubs') resolve(); });
    });
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

beforeEach(() => {
    server.events.removeAllListeners();
    servePopular([]);
});

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
        expect(items.map((a) => a.getAttribute('href'))).toEqual(['/hubs/31', '/hubs/21', '/hubs']);
        expect(screen.getAllByTestId('hub-kind-chip').map((c) => c.textContent)).toEqual(['Server', 'Community']);
        expect(menu).toHaveTextContent('Your hubs');
        expect(screen.getByTestId('nav-hubs-browse-all')).toHaveTextContent('Browse all hubs');
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('a long hub list scrolls inside a viewport-bounded menu; "Browse all hubs" stays outside the scroll (Codex r2)', async () => {
        serve(Array.from({ length: 30 }, (_, i) => hub(100 + i, `Hub ${i}`, i % 2 ? 'game_server' : 'game_community')));
        const menu = await openMenu();
        expect(menu.className).toMatch(/max-h-\[calc\(100dvh/);
        const list = screen.getByTestId('nav-hubs-menu-list');
        expect(list.className).toContain('overflow-y-auto');
        expect(list.querySelectorAll('[role="menuitem"]')).toHaveLength(30);
        expect(list).not.toContainElement(screen.getByTestId('nav-hubs-browse-all'));
    });

    it('keeps the dense md rows (the phone sheet alone uses lg)', async () => {
        serve(TWO);
        const menu = await openMenu();
        const rows = await within(menu).findAllByRole('menuitem', { name: /Valheim|BG3/ });
        for (const row of rows) {
            expect(row).toHaveAttribute('data-size', 'md');
            expect(row.className.split(' ')).toEqual(expect.arrayContaining(['min-h-[44px]', 'text-sm']));
        }
        expect(within(menu).getAllByTestId('hub-kind-chip')[0]?.firstElementChild).toHaveClass('text-xs');
    });

    it('a WoW guild row reads "Guild"', async () => {
        serve([hub(11, 'Iron Vanguard', 'wow_guild')]);
        await openMenu();
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Guild');
        expect(screen.getByTitle('Guild hub')).toHaveTextContent('Guild');
    });

    it('the trigger announces a menu and lights on any hub page', async () => {
        serve(TWO);
        renderWithProviders(<HubsNavItem pathname="/hubs/31" />);
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

describe('HubsNavItem — the shared Hubs circle (operator ruling 2026-10-21)', () => {
    /** The decorative 28px circle + a label that shows only from lg; the name comes from aria-label. */
    function expectCircleFace(host: HTMLElement): void {
        expect(host).toHaveAttribute('aria-label', 'Hubs');
        const circle = within(host).getByTestId('nav-hubs-circle');
        expect(circle).toHaveAttribute('aria-hidden', 'true');
        for (const cls of ['h-7', 'w-7', 'rounded-full', 'bg-success', 'text-white']) {
            expect(circle.className.split(' '), `the desktop circle carries ${cls}`).toContain(cls);
        }
        const label = within(host).getByText('Hubs', { exact: true });
        expect(label.className.split(' '), 'the label hides below lg').toEqual(expect.arrayContaining(['hidden', 'lg:inline']));
        expect(label.className, 'never sr-only + lg:not-sr-only — the unlayered .sr-only wins').not.toMatch(/sr-only/);
    }

    it('the menu trigger leads with the circle, then a label that shows from lg', async () => {
        serve(TWO);
        renderWithProviders(<HubsNavItem pathname="/players" />);
        expectCircleFace(await screen.findByTestId('nav-hubs-menu-trigger'));
    });

    it('the plain link (no hubs) shows the same circle and label', async () => {
        serve([]);
        const done = settled();
        renderWithProviders(<HubsNavItem pathname="/players" />);
        await done;
        expectCircleFace(screen.getByTestId('nav-hubs-link'));
    });

    it('active → the circle takes the phone button\'s ring', async () => {
        serve([]);
        renderWithProviders(<HubsNavItem pathname="/hubs" />);
        expect(screen.getByTestId('nav-hubs-circle').className).toContain('ring-success/40');
    });
});

const hrefs = (menu: HTMLElement): (string | null)[] =>
    Array.from(menu.querySelectorAll('[role="menuitem"]')).map((a) => a.getAttribute('href'));

describe('HubsNavItem — Popular hubs section (ROK-2152)', () => {
    it('"Your hubs" rows, then the "Popular hubs" heading + at most 5 rows in server order, then "Browse all hubs" last', async () => {
        serve([TWO[0] ?? hub(31, 'x', 'game_server')]);
        servePopular(popular(6));
        const menu = await openMenu();
        expect(await within(menu).findAllByTestId('popular-hub-row')).toHaveLength(5);
        expect(hrefs(menu)).toEqual(['/hubs/31', '/hubs/501', '/hubs/502', '/hubs/503', '/hubs/504', '/hubs/505', '/hubs']);
        const yours = within(menu).getByText('Your hubs');
        const heading = within(menu).getByTestId('popular-hubs-heading');
        expect(heading).toHaveTextContent('Popular hubs');
        expect(yours.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING, '"Popular hubs" follows "Your hubs"').toBeTruthy();
        expect(screen.getByTestId('nav-hubs-menu-list'), 'both sections scroll together').toContainElement(heading);
        for (const row of within(menu).getAllByTestId('popular-hub-row')) expect(row).toHaveAttribute('data-size', 'md');
    });

    it('no popular hubs → no section and no "Popular hubs" heading', async () => {
        serve(TWO);
        const done = popularSettled();
        const menu = await openMenu();
        await done;
        await new Promise((r) => setTimeout(r, 0));
        expect(within(menu).queryByTestId('popular-hubs-section')).not.toBeInTheDocument();
        expect(menu).not.toHaveTextContent('Popular hubs');
    });

    it('a failed popular read → the menu keeps "Your hubs" only', async () => {
        serve(TWO);
        server.use(http.get(DIRECTORY, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const done = popularSettled();
        const menu = await openMenu();
        await done;
        await new Promise((r) => setTimeout(r, 0));
        expect(within(menu).queryByTestId('popular-hubs-section')).not.toBeInTheDocument();
        expect(hrefs(menu)).toEqual(['/hubs/31', '/hubs/21', '/hubs']);
    });

    it('a pending popular read → the menu keeps "Your hubs" only (it never waits on it)', async () => {
        serve(TWO);
        server.use(http.get(DIRECTORY, async () => { await delay('infinite'); return HttpResponse.json({}); }));
        const menu = await openMenu();
        expect(menu).toHaveTextContent('Your hubs');
        expect(within(menu).queryByTestId('popular-hubs-section')).not.toBeInTheDocument();
    });

});

describe('HubsNavItem — Popular hubs: zero-hub viewers (Q1), keys and picks (ROK-2152)', () => {
    it('Q1: no hubs of your own + 3 popular → the menu (not the link), with "Popular hubs" only', async () => {
        serve([]);
        servePopular(popular(3));
        const menu = await openMenu();
        expect(screen.queryByTestId('nav-hubs-link')).not.toBeInTheDocument();
        expect(menu).not.toHaveTextContent('Your hubs');
        expect(within(menu).queryAllByTestId('guild-entry-row')).toHaveLength(0);
        expect(hrefs(menu)).toEqual(['/hubs/501', '/hubs/502', '/hubs/503', '/hubs']);
    });

    it('Q1: popular hubs while your own list is still loading → still the plain link', async () => {
        server.use(http.get(MINE, async () => { await delay('infinite'); return HttpResponse.json({ guilds: [] }); }));
        servePopular(popular(3));
        const done = popularSettled();
        renderWithProviders(<HubsNavItem pathname="/players" />);
        await done;
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.getByTestId('nav-hubs-link')).toHaveAttribute('href', '/hubs');
        expect(screen.queryByTestId('nav-hubs-menu-trigger')).not.toBeInTheDocument();
    });

    it('arrows cross from your rows into the popular rows; End lands on "Browse all hubs"', async () => {
        serve([TWO[0] ?? hub(31, 'x', 'game_server')]);
        servePopular(popular(2));
        const menu = await openMenu();
        const firstPopular = (await within(menu).findAllByTestId('popular-hub-row'))[0];
        await waitFor(() => expect(document.activeElement).toHaveAttribute('href', '/hubs/31'));
        await userEvent.keyboard('{ArrowDown}');
        expect(document.activeElement).toBe(firstPopular);
        await userEvent.keyboard('{End}');
        expect(document.activeElement).toBe(screen.getByTestId('nav-hubs-browse-all'));
    });

    it('picking a popular row closes the menu and opens that hub', async () => {
        function Where(): JSX.Element { return <output data-testid="where">{useLocation().pathname}</output>; }
        serve(TWO);
        servePopular(popular(2));
        renderWithProviders(<><HubsNavItem pathname="/players" /><Where /></>);
        await userEvent.click(await screen.findByTestId('nav-hubs-menu-trigger'));
        const row = (await screen.findAllByTestId('popular-hub-row'))[1] ?? document.body;
        await userEvent.click(row);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByTestId('where')).toHaveTextContent('/hubs/502');
    });
});
