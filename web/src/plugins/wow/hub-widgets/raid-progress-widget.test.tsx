/**
 * ROK-1917 (W10) — the WoW: Forever "Raid progress" hub widget: the headline
 * counts, boss rows in API order (first kill / "Not killed yet", kills, wipes),
 * the difficulty label only for an encounter at two difficulties (and never a
 * null one), the 8-row cap + "N more bosses" disclosure, the AC7 empty state,
 * the visitor probe and the registration (id, order, span, audience, action).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage, WowRosterRaidProgressBossDto, WowRosterRaidProgressDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import { VISITOR_FIXTURE, createBareRosterInsights, rosterInsightsHandler } from '../../../test/handlers/forever-hub-widgets';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import RaidProgressWidget from './raid-progress-widget';
import { raidProgressWidget, useRaidProgressVisible } from './raid-progress.register';
import { firstKillLine } from './raid-progress.helpers';
import { EventsSeeAll } from './see-all-actions';
import { useRosterInsights } from './use-roster-insights';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 86_400_000).toISOString();
const NOV_6 = '2026-11-06T21:30:00.000Z';

function boss(name: string, over: Partial<WowRosterRaidProgressBossDto> = {}): WowRosterRaidProgressBossDto {
    return {
        encounterId: name.length * 100, difficultyId: 3, difficultyLabel: '40-player', name,
        firstKillAt: NOV_6, kills: 3, wipes: 2, lastPullAt: TWO_DAYS_AGO, ...over,
    };
}

function progress(bosses: WowRosterRaidProgressBossDto[], over: Partial<WowRosterRaidProgressDto> = {}): WowRosterRaidProgressDto {
    return { bosses, killedCount: 6, pullCount: 41, lastPullAt: TWO_DAYS_AGO, ...over };
}

/** Eleven distinct bosses: six killed, then five never killed (most wipes first). */
const ELEVEN = [
    'Lucifron', 'Magmadar', 'Gehennas', 'Onyxia', 'Garr', 'Sulfuron',
    'Baron Geddon', 'Shazzrah', 'Golemagg', 'Majordomo', 'Ragnaros',
].map((name, i) => boss(name, i < 6
    ? { encounterId: 600 + i, kills: i === 3 ? 1 : 3 }
    : { encounterId: 600 + i, firstKillAt: null, kills: 0, wipes: 12 - i }));

const EMPTY: WowRosterRaidProgressDto = { bosses: [], killedCount: 0, pullCount: 0, lastPullAt: null };

function ctx(): Pick<HubWidgetCtx, 'page'> {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 42, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page };
}

async function renderWith(raidProgress: WowRosterRaidProgressDto): Promise<void> {
    server.use(rosterInsightsHandler({ all: createBareRosterInsights({ raidProgress }) }));
    renderWithProviders(<RaidProgressWidget {...ctx()} />);
    await screen.findByTestId('forever-freshness');
}

/** A missing row fails loudly with its name, never as a silent `undefined`. */
function must<T>(value: T | undefined, label: string): T {
    if (value === undefined) throw new Error(`expected a ${label} row`);
    return value;
}

function rows(): HTMLElement[] {
    return within(screen.getByRole('list', { name: 'Raid bosses' })).getAllByRole('listitem');
}

describe('RaidProgressWidget', () => {
    it('heads the card with bosses killed and pulls, dated by the latest pull', async () => {
        await renderWith(progress(ELEVEN));
        expect(screen.getByTestId('raid-progress-killed')).toHaveTextContent('6bosses killed');
        expect(screen.getByTestId('raid-progress-pulls')).toHaveTextContent('from 41 pulls in LedgerLink raid exports');
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent('via LedgerLink · as of 2 days ago');
    });

    it('lists bosses in API order with first kill, kills and wipes', async () => {
        await renderWith(progress(ELEVEN));
        const [first, , , onyxia] = rows();
        expect(first).toHaveTextContent('Lucifron');
        expect(first).toHaveTextContent(firstKillLine(NOV_6));
        expect(firstKillLine(NOV_6)).toMatch(/^First kill \S+ \d+$|^First kill \d+ \S+$/);
        expect(within(must(first, 'first')).getByTestId('raid-progress-kills')).toHaveTextContent('3 kills');
        expect(within(must(first, 'first')).getByTestId('raid-progress-wipes')).toHaveTextContent('2 wipes');
        expect(within(must(onyxia, 'onyxia')).getByTestId('raid-progress-kills')).toHaveTextContent(/^1 kill$/);
        expect(first).toHaveClass('min-h-11');
    });

    it('says "Not killed yet" with 0 kills for a boss that has only wipes', async () => {
        await renderWith(progress(ELEVEN));
        const geddon = rows()[6];
        expect(geddon).toHaveTextContent('Baron Geddon');
        expect(geddon).toHaveTextContent('Not killed yet');
        expect(within(must(geddon, 'geddon')).getByTestId('raid-progress-kills')).toHaveTextContent(/^0 kills$/);
        expect(within(must(geddon, 'geddon')).getByTestId('raid-progress-wipes')).toHaveTextContent('6 wipes');
    });

    it('shows 8 rows, then "3 more bosses" expands to all 11 and collapses again', async () => {
        await renderWith(progress(ELEVEN));
        expect(rows()).toHaveLength(8);
        const more = screen.getByRole('button', { name: /3 more bosses/ });
        expect(more).toHaveAttribute('aria-expanded', 'false');
        expect(more).toHaveClass('min-h-11');
        await userEvent.click(more);
        expect(more).toHaveAttribute('aria-expanded', 'true');
        expect(rows()).toHaveLength(11);
        expect(rows()[10]).toHaveTextContent('Ragnaros');
        await userEvent.click(screen.getByRole('button', { name: /Show fewer bosses/ }));
        expect(rows()).toHaveLength(8);
    });

    it('has no disclosure when every boss fits', async () => {
        await renderWith(progress(ELEVEN.slice(0, 8)));
        expect(rows()).toHaveLength(8);
        expect(screen.queryByTestId('raid-progress-more')).toBeNull();
    });
});

describe('RaidProgressWidget difficulty labels', () => {
    it('labels only an encounter seen at two difficulties, and never shows a null label', async () => {
        await renderWith(progress([
            boss('Hyjal Guardian', { encounterId: 900, difficultyId: 4, difficultyLabel: '20-player' }),
            boss('Hyjal Guardian', { encounterId: 900, difficultyId: 3, difficultyLabel: null, firstKillAt: null, kills: 0 }),
            boss('Lucifron', { encounterId: 663, difficultyLabel: '40-player' }),
        ]));
        const [hyjal20, hyjalUnmapped, lucifron] = rows();
        expect(within(must(hyjal20, 'hyjal20')).getByTestId('raid-progress-difficulty')).toHaveTextContent('20-player');
        expect(within(must(hyjalUnmapped, 'hyjalUnmapped')).queryByTestId('raid-progress-difficulty')).toBeNull();
        expect(within(must(lucifron, 'lucifron')).queryByTestId('raid-progress-difficulty')).toBeNull();
        expect(lucifron).not.toHaveTextContent('40-player');
    });
});

describe('RaidProgressWidget empty state', () => {
    it('shows the AC7 line, with no boss list, before any pull is reported', async () => {
        await renderWith(EMPTY);
        expect(screen.getByTestId('raid-progress-empty'))
            .toHaveTextContent("No raid pulls yet — a raider's LedgerLink raid export fills this card.");
        expect(screen.queryByRole('list', { name: 'Raid bosses' })).toBeNull();
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent(/^via LedgerLink$/);
    });
});

describe('useRaidProgressVisible', () => {
    function wrapper({ children }: { children: ReactNode }): JSX.Element {
        return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
    }

    it('hides the card for a visitor payload (no raidProgress key)', async () => {
        server.use(rosterInsightsHandler({ all: VISITOR_FIXTURE }));
        const { result } = renderHook(() => ({
            visible: useRaidProgressVisible(ctx()),
            data: useRosterInsights(ctx().page.guild.id, false).data,
        }), { wrapper });
        await waitFor(() => expect(result.current.data).toBeDefined());
        expect(result.current.visible).toBe(false);
    });

    it('shows the card for a member payload, even before any pull is reported', async () => {
        server.use(rosterInsightsHandler({ all: createBareRosterInsights({ raidProgress: EMPTY }) }));
        const { result } = renderHook(() => useRaidProgressVisible(ctx()), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
    });
});

describe('raidProgressWidget registration', () => {
    it('is the Forever guild "Raid progress" card at order 89, span 2, with the Events see-all action', () => {
        expect(raidProgressWidget).toMatchObject({
            id: 'forever-raid-progress', title: 'Raid progress', order: 89, span: 2, audience: 'everyone',
            games: ['world-of-warcraft-forever'], kinds: ['wow_guild'],
        });
        expect(raidProgressWidget.action).toBe(EventsSeeAll);
    });
});
