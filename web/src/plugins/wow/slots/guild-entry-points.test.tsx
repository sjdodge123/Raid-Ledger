/**
 * ROK-1785 — guild entry points: each WoW filler for one guild, two guilds
 * and none (renders nothing), plus the hosts' generic slots.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { PluginSlot } from '../../plugin-slot';
import { NavGuildLink } from './nav-guild-link';
import { DrawerYourGuild } from './drawer-your-guild';
import { PlayersGuildCard } from './players-guild-card';
import { GameDetailGuilds } from './game-detail-guilds';
import { CharacterGuildBadge } from './character-guild-badge';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000/plugins/wow/guilds';
const CHAR_ID = '5b3c6f3e-1d2a-4c9b-9a51-2f8e7d6c5b4a';

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
        http.get(`${API}/mine`, () => HttpResponse.json({ guilds })),
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
        expect(await screen.findByTestId('drawer-your-guild')).toHaveTextContent('Your guild');
        await userEvent.click(screen.getByTestId('guild-entry-row'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('two guilds → "Your guilds" with both rows', async () => {
        serve(TWO);
        renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        expect(await screen.findByText('Your guilds')).toBeInTheDocument();
        expect(screen.getAllByTestId('guild-entry-row')).toHaveLength(2);
    });

    it('no guild → nothing', async () => {
        serve([]);
        const { container } = renderWithProviders(<DrawerYourGuild onClose={vi.fn()} />);
        await expectEmpty(container, '/guilds/mine');
    });
});

describe('PlayersGuildCard (players:header-cards)', () => {
    it('one guild → name, member count and "Open guild page"', async () => {
        serve(ONE);
        renderWithProviders(<PlayersGuildCard />);
        const card = await screen.findByTestId('players-guild-card');
        expect(card).toHaveTextContent('Iron Vanguard');
        expect(screen.getByTestId('players-guild-member-count')).toHaveTextContent('12 members');
        expect(screen.getByTestId('players-guild-open')).toHaveAttribute('href', '/guilds/11');
    });

    it('two guilds → two cards', async () => {
        serve(TWO);
        renderWithProviders(<PlayersGuildCard />);
        await waitFor(() => expect(screen.getAllByTestId('players-guild-card')).toHaveLength(2));
        expect(screen.getAllByTestId('players-guild-member-count')[1]).toHaveTextContent('1 member');
    });

    // ROK-1830 S5b (D11-B): the slot is no longer empty for a hub-less viewer —
    // it offers core's dismissible "get your guild" prompt with the WoW how-to.
    it('not a member → the "get your guild" prompt, with the LedgerLink line', async () => {
        serve([]);
        server.use(http.get('http://localhost:3000/guilds/onboarding', () => HttpResponse.json({ dismissed: [] })));
        renderWithProviders(<PlayersGuildCard />);
        await screen.findByTestId('get-your-guild-card');
        // ROK-1840: the S0 prototype folds the how-to behind a primary toggle.
        const toggle = screen.getByTestId('get-your-guild-how-toggle');
        expect(toggle).toHaveTextContent('How to import');
        await userEvent.click(toggle);
        expect(screen.getByTestId('get-your-guild-how')).toHaveTextContent('LedgerLink');
        expect(screen.queryByTestId('players-guild-card')).not.toBeInTheDocument();
    });

    // PR-3 MAJOR: `useMyGuilds()` answered `[]` while loading, so a real
    // member saw the hub-less prompt flash on every cold /players — and could
    // dismiss a card they never meant to see. The onboarding query is served
    // here so it settles FIRST, which is exactly the race that broke it.
    it('while /guilds/mine is in flight → neither card', async () => {
        server.use(
            http.get('http://localhost:3000/guilds/onboarding', () => HttpResponse.json({ dismissed: [] })),
            http.get(`${API}/mine`, () => new Promise<never>(() => { /* never settles */ })),
        );
        const { container } = renderWithProviders(<PlayersGuildCard />);
        await waitFor(() => expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument());
        await new Promise((r) => setTimeout(r, 0));
        expect(container.innerHTML).toBe('');
    });

    it('when /guilds/mine fails → nothing, never the hub-less prompt', async () => {
        let failed = false;
        server.use(
            http.get('http://localhost:3000/guilds/onboarding', () => HttpResponse.json({ dismissed: [] })),
            http.get(`${API}/mine`, () => { failed = true; return HttpResponse.json({ message: 'boom' }, { status: 500 }); }),
        );
        const { container } = renderWithProviders(<PlayersGuildCard />);
        await waitFor(() => expect(failed).toBe(true));
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument();
        expect(container.innerHTML).toBe('');
    });

    it('a member never sees the hub-less prompt', async () => {
        serve(ONE);
        server.use(http.get('http://localhost:3000/guilds/onboarding', () => HttpResponse.json({ dismissed: [] })));
        renderWithProviders(<PlayersGuildCard />);
        await screen.findByTestId('players-guild-card');
        expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument();
    });
});

describe('GameDetailGuilds (game-detail:sections)', () => {
    it('one guild → a "Guilds" list with a View link', async () => {
        serve(ONE);
        renderWithProviders(<GameDetailGuilds gameId={7} gameSlug="wow" />);
        const section = await screen.findByTestId('game-detail-guilds');
        expect(section).toHaveTextContent('Guilds');
        expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/guilds/11');
    });

    it('two guilds → two rows, asked for this game', async () => {
        let asked = '';
        server.use(http.get(API, ({ request }) => { asked = new URL(request.url).search; return HttpResponse.json({ guilds: TWO }); }));
        renderWithProviders(<GameDetailGuilds gameId={7} gameSlug="wow" />);
        await waitFor(() => expect(screen.getAllByTestId('game-guild-row')).toHaveLength(2));
        expect(asked).toBe('?gameId=7');
    });

    it('no guilds → nothing', async () => {
        serve([]);
        const { container } = renderWithProviders(<GameDetailGuilds gameId={7} gameSlug="wow" />);
        await expectEmpty(container, '/plugins/wow/guilds?gameId=7');
    });
});

describe('CharacterGuildBadge (character-detail:header-badges)', () => {
    it('in a guild → crest + name + rank, linking to the guild', async () => {
        server.use(http.get(`${API}/by-character/${CHAR_ID}`, () =>
            HttpResponse.json({ data: { guild: { ...guild(11, 'Iron Vanguard'), rankIndex: undefined, rankName: undefined, canEdit: undefined, gmPostHeadline: undefined }, rankName: 'Officer', viewerCanOpen: true } })));
        renderWithProviders(<CharacterGuildBadge characterId={CHAR_ID} />);
        const badge = await screen.findByTestId('character-guild-badge');
        expect(badge).toHaveAttribute('href', '/guilds/11');
        expect(badge).toHaveTextContent('Iron Vanguard');
        expect(badge).toHaveTextContent('Officer');
    });

    it('a viewer who cannot open the guild → plain text, no link', async () => {
        server.use(http.get(`${API}/by-character/${CHAR_ID}`, () =>
            HttpResponse.json({ data: { guild: { ...guild(11, 'Iron Vanguard'), rankIndex: undefined, rankName: undefined, canEdit: undefined, gmPostHeadline: undefined }, rankName: 'Officer', viewerCanOpen: false } })));
        renderWithProviders(<CharacterGuildBadge characterId={CHAR_ID} />);
        const badge = await screen.findByTestId('character-guild-badge');
        expect(badge.tagName, 'a non-member must not get a link to the guild page').toBe('SPAN');
        expect(badge).not.toHaveAttribute('href');
        expect(badge.querySelector('a')).toBeNull();
        expect(badge).toHaveTextContent('Iron Vanguard');
    });

    it('no guild → nothing', async () => {
        server.use(http.get(`${API}/by-character/${CHAR_ID}`, () => HttpResponse.json({ data: null })));
        const { container } = renderWithProviders(<CharacterGuildBadge characterId={CHAR_ID} />);
        await expectEmpty(container, `/by-character/${CHAR_ID}`);
    });
});

describe('generic slots', () => {
    it('the WoW plugin fills every new slot', async () => {
        activateWowPlugin();
        serve(ONE);
        renderWithProviders(<><PluginSlot name="nav:primary-links" context={{ pathname: '/' }} /><PluginSlot name="nav:drawer-top" context={{ onClose: vi.fn() }} /><PluginSlot name="players:header-cards" /><PluginSlot name="game-detail:sections" context={{ gameId: 7, gameSlug: 'wow' }} /></>);
        for (const id of ['nav-guild-link', 'drawer-your-guild', 'players-guild-card', 'game-detail-guilds']) {
            expect(await screen.findByTestId(id)).toBeInTheDocument();
        }
    });

    it('the drawer slot hands the host\'s onClose to "Your guild", so a tap closes the drawer', async () => {
        activateWowPlugin();
        serve(ONE);
        const onClose = vi.fn();
        renderWithProviders(<PluginSlot name="nav:drawer-top" context={{ onClose }} />);
        await userEvent.click(await screen.findByTestId('guild-entry-row'));
        expect(onClose, 'tapping a guild in the drawer must call the drawer\'s onClose').toHaveBeenCalledTimes(1);
    });

    it.each([
        // Hidden below lg so the md (768) header matches main's (ROK-1785 verify flag).
        ['components/layout/Header.tsx', '<span className="hidden lg:contents"><PluginSlot name="nav:primary-links" context={{ pathname }} /></span>'],
        ['components/layout/more-drawer.tsx', '<PluginSlot name="nav:drawer-top" context={{ onClose }} />'],
        ['pages/players-page.tsx', '<PluginSlot name="players:header-cards" />'],
        ['pages/game-detail-page.tsx', '<PluginSlot name="game-detail:sections" context={{ gameId, gameSlug: game.slug }} />'],
        ['pages/character-detail-page.tsx', 'name="character-detail:header-badges" context={{ characterId: character.id,'],
    ])('%s hosts its slot', (file, snippet) => {
        const src = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
        expect(src.includes(snippet), `${file} is missing: ${snippet}`).toBe(true);
    });
});
