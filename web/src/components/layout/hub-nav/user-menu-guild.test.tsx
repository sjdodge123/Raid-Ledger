/**
 * ROK-1785 entry E (tablet), core since ROK-1870 D9: the user-menu hub group — one item per guild
 * for members, 768–1023px only (hidden from lg), nothing for non-members.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { UserMenuGuild } from './user-menu-guild';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const MINE = 'http://localhost:3000/guilds/mine';

function guild(id: number, name: string): MyGuild {
    return {
        id, gameId: 7, kind: 'wow_guild', name, region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde',
        memberCount: 3, lastSnapshotAt: null, rankIndex: 2, rankName: 'Raider', canEdit: false, gmPostHeadline: null,
    };
}

function serve(guilds: MyGuild[]): void {
    server.use(http.get(MINE, () => HttpResponse.json({ guilds })));
}

beforeEach(() => { server.events.removeAllListeners(); });

describe('UserMenuGuild (user-menu:items)', () => {
    it('one guild → one item to its page, hidden from lg; a click closes the menu', async () => {
        serve([guild(11, 'Iron Vanguard')]);
        const onClose = vi.fn();
        renderWithProviders(<UserMenuGuild onClose={onClose} />);
        const item = await screen.findByRole('link', { name: 'Iron Vanguard' });
        expect(item).toHaveAttribute('href', '/guilds/11');
        expect(screen.getByTestId('user-menu-guild').className, '≥1024px uses the header link instead').toBe('lg:hidden');
        await userEvent.click(item);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('two guilds → one item per guild', async () => {
        serve([guild(11, 'Iron Vanguard'), guild(12, 'Dusk Wardens')]);
        renderWithProviders(<UserMenuGuild onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getAllByTestId('user-menu-guild-item')).toHaveLength(2));
        expect(screen.getAllByTestId('user-menu-guild-item').map((a) => a.getAttribute('href'))).toEqual(['/guilds/11', '/guilds/12']);
    });

    it('not a member → nothing', async () => {
        let hit = false;
        server.events.on('response:mocked', ({ request }) => { if (request.url.includes('/guilds/mine')) hit = true; });
        serve([]);
        const { container } = renderWithProviders(<UserMenuGuild onClose={vi.fn()} />);
        await waitFor(() => expect(hit, 'expected the guild query to settle').toBe(true));
        await new Promise((r) => setTimeout(r, 0));
        expect(container.innerHTML).toBe('');
    });

    it('a community hub shows with no plugin active (ROK-1870 D9)', async () => {
        serve([{ ...guild(21, 'BG3 Crew'), kind: 'game_community', region: 'community', realmSlug: null }]);
        renderWithProviders(<UserMenuGuild onClose={vi.fn()} />);
        expect(await screen.findByRole('link', { name: 'BG3 Crew' })).toHaveAttribute('href', '/guilds/21');
    });
});
