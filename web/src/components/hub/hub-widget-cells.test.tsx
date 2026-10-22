/** ROK-1909 — plugin game widgets on the hub Overview: gating, chrome, containment. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { lazy, type ComponentType, type JSX } from 'react';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { clearRegistry, registerPlugin } from '../../plugins/plugin-registry';
import type { HubGameWidget, HubWidgetCtx } from '../../plugins/hub-game-widgets';
import { renderWithProviders } from '../../test/render-helpers';
import { gameWidgetCells } from './hub-widget-cells';

function lazyOf(c: ComponentType<HubWidgetCtx>): HubGameWidget['component'] {
    return lazy(() => Promise.resolve({ default: c }));
}

const Body: ComponentType<HubWidgetCtx> = ({ gameSlug }) => <p data-testid="forever-body">Classes on {gameSlug}</p>;
const Boom: ComponentType<HubWidgetCtx> = () => {
    throw new Error('widget exploded');
};

function page(role: GuildPage['viewer']['role'] = 'member', gameSlug = 'forever'): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role, canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function Harness({ p, active = new Set(['wow']) }: { p: GuildPage; active?: ReadonlySet<string> }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['harness-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    return <div data-testid="grid">{gameWidgetCells({ page: p, raids }, active).map((c) => <div key={c.key}>{c.node}</div>)}</div>;
}

function register(over: Partial<HubGameWidget> = {}): void {
    registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerHubWidget({
        id: 'classes', title: 'Class breakdown', games: ['forever'], order: 45, audience: 'everyone', component: lazyOf(Body), ...over,
    });
}

beforeEach(() => clearRegistry());

describe('gameWidgetCells', () => {
    it('renders a matching widget in WidgetCard chrome with the game slug', async () => {
        register();
        renderWithProviders(<Harness p={page()} />);
        expect(await screen.findByTestId('forever-body')).toHaveTextContent('Classes on forever');
        expect(screen.getByRole('heading', { name: 'Class breakdown' })).toBeInTheDocument();
        expect(document.getElementById('hub-widget-wow-classes')).not.toBeNull();
    });

    it('renders nothing for an inactive plugin or another game', () => {
        register();
        const { unmount } = renderWithProviders(<Harness p={page()} active={new Set()} />);
        expect(screen.queryByRole('heading', { name: 'Class breakdown' })).toBeNull();
        unmount();
        renderWithProviders(<Harness p={page('member', 'classic')} />);
        expect(screen.queryByRole('heading', { name: 'Class breakdown' })).toBeNull();
    });

    it('hides a members widget from a visitor and shows it to a member', () => {
        register({ audience: 'members' });
        const { unmount } = renderWithProviders(<Harness p={page('visitor')} />);
        expect(screen.queryByRole('heading', { name: 'Class breakdown' })).toBeNull();
        unmount();
        renderWithProviders(<Harness p={page('member')} />);
        expect(screen.getByRole('heading', { name: 'Class breakdown' })).toBeInTheDocument();
    });

});

describe('gameWidgetCells — mounting, reset and containment', () => {
    it('never mounts a members widget for a visitor: no lazy load, no useVisible call (gate before mount)', () => {
        const load = vi.fn(() => Promise.resolve({ default: Body }));
        const probe = vi.fn(() => true);
        register({ audience: 'members', component: lazy(load), useVisible: probe });
        renderWithProviders(<Harness p={page('visitor')} />);
        expect(screen.queryByRole('heading', { name: 'Class breakdown' })).toBeNull();
        expect(load).not.toHaveBeenCalled();
        expect(probe).not.toHaveBeenCalled();
    });

    it('resets a failed card when the same cell moves to another hub', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const FailsOnHubA: ComponentType<HubWidgetCtx> = ({ page: p }) => {
            if (p.guild.id === 7) throw new Error('hub A only');
            return <p data-testid="forever-body">Hub {p.guild.id}</p>;
        };
        register({ component: lazyOf(FailsOnHubA) });
        const hubA = page();
        const hubB: GuildPage = { ...hubA, guild: { ...hubA.guild, id: 8 } };
        const { rerender } = renderWithProviders(<Harness p={hubA} />);
        expect(await screen.findByText(/couldn't load this widget/i)).toBeInTheDocument();
        rerender(<Harness p={hubB} />);
        expect(await screen.findByTestId('forever-body')).toHaveTextContent('Hub 8');
        expect(screen.queryByText(/couldn't load this widget/i)).toBeNull();
    });

    it('hides the card when useVisible says false', () => {
        register({ useVisible: () => false });
        renderWithProviders(<Harness p={page()} />);
        expect(screen.queryByRole('heading', { name: 'Class breakdown' })).toBeNull();
    });

    it('contains a throwing widget: its card shows an error, siblings still render', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        register({ id: 'boom', title: 'Broken', order: 40, component: lazyOf(Boom) });
        register();
        renderWithProviders(<Harness p={page()} />);
        expect(await screen.findByTestId('forever-body')).toBeInTheDocument();
        expect(await screen.findByText(/couldn't load this widget/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Broken' })).toBeInTheDocument();
    });

    it('spans the full row at ≥1024px and clamps to two columns at ≥768px', () => {
        register({ span: 3 });
        renderWithProviders(<Harness p={page()} />);
        const wrap = document.getElementById('hub-widget-wow-classes')?.parentElement;
        expect(wrap?.className).toContain('md:col-span-2');
        expect(wrap?.className).toContain('lg:col-span-3');
    });
});
