/** ROK-1921 — WoW: Forever Class breakdown (W1) + Level progression (W2) hub widgets. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    MOCK_CHAR_IDS, createEmptyRosterInsights, createMockRosterInsights, daysAgoIso, rosterInsightsHandler,
} from '../../../test/handlers/forever-hub-widgets';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { gameWidgetCells } from '../../../components/hub/hub-widget-cells';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { registerClassLevelWidgets } from './class-level.register';
import ClassBreakdownWidget from './class-breakdown-widget';
import LevelProgressionWidget from './level-progression-widget';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
    useViewerCacheScope: () => 'user:1',
}));

function page(gameSlug = WOW_FOREVER_GAME_SLUG): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 5, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function Body({ W }: { W: (ctx: HubWidgetCtx) => JSX.Element }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['h-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    return <W page={page()} raids={raids} gameSlug={WOW_FOREVER_GAME_SLUG} />;
}

function Overview(): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['h-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    return <div>{gameWidgetCells({ page: page(), raids }, new Set(['blizzard'])).map((c) => <div key={c.key}>{c.node}</div>)}</div>;
}

beforeEach(() => {
    clearRegistry();
    registerClassLevelWidgets(registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' }));
});

describe('W1 Class breakdown', () => {
    it('draws one bar per class with its count', async () => {
        server.use(rosterInsightsHandler());
        renderWithProviders(<Body W={ClassBreakdownWidget} />);
        expect(await screen.findByTestId('forever-class-Warrior')).toHaveTextContent('3');
        expect(screen.getByTestId('forever-class-Mage')).toHaveTextContent('2');
    });

    it('draws the class bar in the neutral meter tone (a count is not good or bad)', async () => {
        server.use(rosterInsightsHandler());
        renderWithProviders(<Body W={ClassBreakdownWidget} />);
        const meter = within(await screen.findByTestId('forever-class-Warrior')).getByRole('meter', { hidden: true });
        expect(meter.firstElementChild).toHaveClass('bg-secondary');
        // The Button's label span must stretch, or the flex-1 meter collapses to 0 width.
        expect(screen.getByTestId('forever-class-Warrior')).toHaveClass('[&>[data-button-label]]:w-full');
    });

    it('opens a member list: linked names go to the character sheet, unlinked to #members', async () => {
        server.use(rosterInsightsHandler());
        renderWithProviders(<Body W={ClassBreakdownWidget} />);
        const bar = await screen.findByTestId('forever-class-Warrior');
        expect(bar).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(bar);
        expect(bar).toHaveAttribute('aria-expanded', 'true');
        const list = screen.getByTestId('forever-class-members-Warrior');
        expect(within(list).getByRole('link', { name: /Thrall/ })).toHaveAttribute('href', `/characters/${MOCK_CHAR_IDS.thrall}`);
        expect(within(list).getByRole('link', { name: /Garrosh/ })).toHaveAttribute('href', '#members');
    });

    it('the mains-only toggle refetches with ?mainsOnly=true', async () => {
        const seen: string[] = [];
        const mains = createMockRosterInsights({ classes: [{ class: 'Warrior', count: 1, members: [{ name: 'Thrall', characterId: MOCK_CHAR_IDS.thrall, level: 60 }] }] });
        server.use(rosterInsightsHandler({ mains, onRequest: (u) => seen.push(u.search) }));
        renderWithProviders(<Body W={ClassBreakdownWidget} />);
        expect(await screen.findByTestId('forever-class-Warrior')).toHaveTextContent('3');
        fireEvent.click(screen.getByRole('switch', { name: 'Mains only' }));
        await waitFor(() => expect(screen.getByTestId('forever-class-Warrior')).toHaveTextContent('1'));
        expect(seen).toContain('?mainsOnly=true');
        expect(screen.queryByTestId('forever-class-Mage')).toBeNull();
    });

    it('shows the freshness footer', async () => {
        server.use(rosterInsightsHandler());
        renderWithProviders(<Body W={ClassBreakdownWidget} />);
        await screen.findByTestId('forever-class-Warrior');
        const foot = screen.getByTestId('forever-freshness');
        expect(foot).toHaveTextContent('via LedgerLink · as of 3 days ago');
        expect(foot).toHaveAttribute('data-stale', 'false');
    });
});

describe('W2 Level progression', () => {
    it('draws the histogram buckets, median, max and at-cap count', async () => {
        server.use(rosterInsightsHandler());
        renderWithProviders(<Body W={LevelProgressionWidget} />);
        const top = await screen.findByTestId('forever-level-bucket-60-60');
        expect(top).toHaveAttribute('href', '#members');
        expect(top).toHaveAccessibleName('Level 60: 2 members');
        expect(screen.getByTestId('forever-level-bucket-10-19')).toHaveAccessibleName('Levels 10–19: 1 member');
        expect(screen.getByTestId('forever-level-median')).toHaveTextContent('55');
        expect(screen.getByTestId('forever-level-max')).toHaveTextContent('60');
        expect(screen.getByTestId('forever-level-at-cap')).toHaveTextContent('2');
    });

    it('lists the five highest names, highest first', async () => {
        server.use(rosterInsightsHandler());
        renderWithProviders(<Body W={LevelProgressionWidget} />);
        const items = within(await screen.findByTestId('forever-level-top')).getAllByRole('listitem');
        expect(items.map((li) => li.textContent)).toEqual(['Thrall60', 'Jaina60', 'Khadgar55', 'Garrosh42', 'Varian18']);
        expect(within(items[0] ?? document.body).getByRole('link')).toHaveAttribute('href', `/characters/${MOCK_CHAR_IDS.thrall}`);
    });

    it('turns the footer to the warning tone past 14 days', async () => {
        const stale = createMockRosterInsights({ freshness: { roster: { source: 'addon', asOf: daysAgoIso(20) }, characters: { addon: 1, blizzard: 0, none: 0 } } });
        server.use(rosterInsightsHandler({ all: stale }));
        renderWithProviders(<Body W={LevelProgressionWidget} />);
        await screen.findByTestId('forever-level-bucket-60-60');
        const foot = screen.getByTestId('forever-freshness');
        expect(foot).toHaveAttribute('data-stale', 'true');
        expect(foot).toHaveClass('text-warning');
        expect(foot).toHaveTextContent('as of 20 days ago');
    });
});

describe('registration', () => {
    it('shows both widgets on a Forever guild hub with a roster', async () => {
        server.use(rosterInsightsHandler());
        renderWithProviders(<Overview />);
        expect(await screen.findByRole('heading', { name: 'Class breakdown' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Level progression' })).toBeInTheDocument();
    });

    it('self-hides both widgets on an empty roster', async () => {
        let calls = 0;
        server.use(rosterInsightsHandler({ all: createEmptyRosterInsights(), onRequest: () => { calls += 1; } }));
        renderWithProviders(<Overview />);
        await waitFor(() => expect(calls).toBeGreaterThan(0));
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByRole('heading', { name: 'Class breakdown' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Level progression' })).toBeNull();
    });
});
