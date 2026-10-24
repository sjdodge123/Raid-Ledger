/** ROK-1922 — the WoW: Forever Role breakdown hub widget (dungeon vs raid ready). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import { gameWidgetCells } from '../../../components/hub/hub-widget-cells';
import { renderWithProviders } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import { ROLES_FIXTURE, ROSTER_INSIGHTS_URL, rosterInsightsHandler, rosterInsightsWithRoles } from '../../../test/handlers/forever-hub-widgets';
import { hasKnownRoles } from './roles.helpers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { registerRolesWidget } from './roles.register';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const DAY = 86_400_000;

function page(gameSlug: string = WOW_FOREVER_GAME_SLUG): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function Harness({ p = page() }: { p?: GuildPage }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['harness-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    return <div>{gameWidgetCells({ page: p, raids }, new Set(['blizzard'])).map((c) => <div key={c.key}>{c.node}</div>)}</div>;
}

beforeEach(() => {
    clearRegistry();
    registerRolesWidget(registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' }));
});

describe('Role breakdown widget', () => {
    it('shows a Dungeon-ready and a Raid-ready band with every role count, to a visitor too', async () => {
        server.use(rosterInsightsHandler({ all: ROLES_FIXTURE }));
        renderWithProviders(<Harness />);
        const dungeon = await screen.findByTestId('forever-roles-band-dungeon');
        expect(within(dungeon).getByText('Dungeon-ready')).toBeInTheDocument();
        expect(within(dungeon).getByTestId('forever-roles-dungeon-tank')).toHaveTextContent('2');
        expect(within(dungeon).getByTestId('forever-roles-dungeon-healer')).toHaveTextContent('3');
        expect(within(dungeon).getByTestId('forever-roles-dungeon-dps')).toHaveTextContent('9');
        expect(within(dungeon).getByTestId('forever-roles-dungeon-unknown')).toHaveTextContent('1');
        const raid = screen.getByTestId('forever-roles-band-raid');
        expect(within(raid).getByText('Raid-ready')).toBeInTheDocument();
        expect(within(raid).getByTestId('forever-roles-raid-dps')).toHaveTextContent('5');
        expect(screen.getByRole('heading', { name: 'Role breakdown' })).toBeInTheDocument();
    });

    it('uses the shared role icons and links every role to the Members tab', async () => {
        server.use(rosterInsightsHandler({ all: ROLES_FIXTURE }));
        renderWithProviders(<Harness />);
        const tank = await screen.findByTestId('forever-roles-dungeon-tank');
        expect(within(tank).getByRole('img', { name: 'tank' })).toBeInTheDocument();
        expect(within(screen.getByTestId('forever-roles-raid-healer')).getByRole('img', { name: 'healer' })).toBeInTheDocument();
        expect(tank).toHaveAttribute('href', '#members');
        expect(screen.getByTestId('forever-roles-raid-unknown')).toHaveAttribute('href', '#members');
        expect(tank).toHaveAccessibleName(/2 dungeon-ready tanks/i);
    });

    it('hides itself when nobody has a role', async () => {
        let served = false;
        const dto = rosterInsightsWithRoles({ dungeon: { tank: 0, healer: 0, dps: 0, unknown: 4 } });
        server.use(http.get(ROSTER_INSIGHTS_URL, () => { served = true; return HttpResponse.json(dto); }));
        renderWithProviders(<Harness />);
        await waitFor(() => expect(served).toBe(true));
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByRole('heading', { name: 'Role breakdown' })).toBeNull();
        expect(hasKnownRoles(dto.roles)).toBe(false);
        expect(hasKnownRoles(rosterInsightsWithRoles({ raid: { tank: 0, healer: 1, dps: 0, unknown: 0 } }).roles)).toBe(true);
    });

    it('is not offered on another game', () => {
        renderWithProviders(<Harness p={page('world-of-warcraft-classic')} />);
        expect(screen.queryByRole('heading', { name: 'Role breakdown' })).toBeNull();
    });

    it('shows a neutral freshness footer for recent data', async () => {
        server.use(rosterInsightsHandler({ all: rosterInsightsWithRoles({ raid: { tank: 1, healer: 0, dps: 0, unknown: 0 } }, new Date(Date.now() - 3 * DAY).toISOString()) }));
        renderWithProviders(<Harness />);
        const footer = await screen.findByTestId('forever-roles-freshness');
        expect(footer).toHaveTextContent('via LedgerLink · as of 3 days ago');
        expect(footer).not.toHaveClass('text-warning');
    });

    it('turns the freshness footer to the warning tone past 14 days', async () => {
        server.use(rosterInsightsHandler({ all: rosterInsightsWithRoles({ raid: { tank: 1, healer: 0, dps: 0, unknown: 0 } }, new Date(Date.now() - 20 * DAY).toISOString()) }));
        renderWithProviders(<Harness />);
        const footer = await screen.findByTestId('forever-roles-freshness');
        expect(footer).toHaveTextContent('as of 20 days ago');
        expect(footer).toHaveClass('text-warning');
    });
});
