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
        id, gameId: 7, name, region: 'us', realmSlug: 'whitemane', faction: 'horde',
        memberCount, lastSnapshotAt: null, rankIndex: 2, rankName: 'Raider', canEdit: false,
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

    it('not a member → nothing', async () => {
        serve([]);
        const { container } = renderWithProviders(<PlayersGuildCard />);
        await expectEmpty(container, '/guilds/mine');
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
            HttpResponse.json({ data: { guild: { ...guild(11, 'Iron Vanguard'), rankIndex: undefined, rankName: undefined, canEdit: undefined }, rankName: 'Officer', viewerCanOpen: true } })));
        renderWithProviders(<CharacterGuildBadge characterId={CHAR_ID} />);
        const badge = await screen.findByTestId('character-guild-badge');
        expect(badge).toHaveAttribute('href', '/guilds/11');
        expect(badge).toHaveTextContent('Iron Vanguard');
        expect(badge).toHaveTextContent('Officer');
    });

    it('a viewer who cannot open the guild → plain text, no link', async () => {
        server.use(http.get(`${API}/by-character/${CHAR_ID}`, () =>
            HttpResponse.json({ data: { guild: { ...guild(11, 'Iron Vanguard'), rankIndex: undefined, rankName: undefined, canEdit: undefined }, rankName: 'Officer', viewerCanOpen: false } })));
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

    it.each([
        ['components/layout/Header.tsx', '<PluginSlot name="nav:primary-links" context={{ pathname }} />'],
        ['components/layout/more-drawer.tsx', '<PluginSlot name="nav:drawer-top" context={{ onClose }} />'],
        ['pages/players-page.tsx', '<PluginSlot name="players:header-cards" />'],
        ['pages/game-detail-page.tsx', '<PluginSlot name="game-detail:sections" context={{ gameId, gameSlug: game.slug }} />'],
        ['pages/character-detail-page.tsx', 'name="character-detail:header-badges" context={{ characterId: character.id,'],
    ])('%s hosts its slot', (file, snippet) => {
        const src = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
        expect(src.includes(snippet), `${file} is missing: ${snippet}`).toBe(true);
    });
});
