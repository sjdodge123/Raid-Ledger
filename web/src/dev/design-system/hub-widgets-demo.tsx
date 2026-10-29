/**
 * Plugin hub widgets demo for /dev/design-system (ROK-1909, design-system §4.27).
 * Lazy-loaded by hub-widgets-section.tsx so it stays out of DesignSystemPage's
 * capped chunk.
 *
 * Registers three sample `HubGameWidget`s for a demo-only plugin + game slug
 * (`ds-demo` — never an active plugin or a real hub's game) and renders them
 * through the REAL cell builder `gameWidgetCells`, so the chrome, the Suspense
 * skeleton and the contained-error state are the shipped ones.
 */
import { lazy, type ComponentType, type JSX } from 'react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { addHubGameWidget, type HubGameWidget, type HubWidgetCtx } from '../../plugins/hub-game-widgets';
import { gameWidgetCells } from '../../components/hub/hub-widget-cells';
import { LazySteamAchievementsWidget } from '../../components/hub/steam-stats/steam-achievements-widget-lazy';
import { LazySteamPlaytimeWidget } from '../../components/hub/steam-stats/steam-playtime-widget-lazy';
import { hubSteamStatsKey } from '../../components/hub/steam-stats/use-hub-steam-stats';
import { DEMO_STEAM_STATS } from './hub-steam-stats-demo-data';
import { Bg3PartyDemoBody, Bg3SessionsDemoBody } from './hub-bg3-demo';

const DEMO = 'ds-demo';
const ACTIVE: ReadonlySet<string> = new Set([DEMO]);
const CLASSES = [['Warrior', 6], ['Priest', 4], ['Mage', 3]] as const;

const ReadyBody: ComponentType<HubWidgetCtx> = () => (
    <ul className="space-y-1 text-sm" data-testid="ds-hub-widget-body">
        {CLASSES.map(([name, n]) => (
            <li key={name} className="flex justify-between text-secondary"><span>{name}</span><span className="text-foreground">{n}</span></li>
        ))}
    </ul>
);

const BrokenBody: ComponentType<HubWidgetCtx> = () => {
    throw new Error('Demo widget failed on purpose');
};

const SeeAll: ComponentType<HubWidgetCtx> = () => <a href="#hub-widgets" className="text-xs text-secondary hover:text-foreground hover:underline">See all</a>;

function lazyOf(c: ComponentType<HubWidgetCtx>): HubGameWidget['component'] {
    return lazy(() => Promise.resolve({ default: c }));
}

const BASE = { games: [DEMO], audience: 'everyone' } as const;
addHubGameWidget(DEMO, { ...BASE, id: 'classes', title: 'Class breakdown', order: 1, component: lazyOf(ReadyBody), action: SeeAll });
addHubGameWidget(DEMO, { ...BASE, id: 'loading', title: 'Loading (skeleton)', order: 2, component: lazy(() => new Promise<never>(() => undefined)) });
addHubGameWidget(DEMO, { ...BASE, id: 'broken', title: 'Contained error', order: 3, component: lazyOf(BrokenBody) });
// ROK-1953 — the real Core Steam card bodies over a seeded cache entry (masked hidden-achievement row).
addHubGameWidget(DEMO, { ...BASE, id: 'steam-achievements', title: 'Achievement race', order: 4, component: LazySteamAchievementsWidget });
addHubGameWidget(DEMO, { ...BASE, id: 'steam-playtime', title: 'Playtime', order: 5, component: LazySteamPlaytimeWidget });
// ROK-1958 — BG3 party slot tile + coverage strip, and the session timeline rail (real components, demo data).
addHubGameWidget(DEMO, { ...BASE, id: 'bg3-party', title: 'Party (BG3)', order: 6, span: 2, component: lazyOf(Bg3PartyDemoBody) });
addHubGameWidget(DEMO, { ...BASE, id: 'bg3-sessions', title: 'Session history (BG3)', order: 7, component: lazyOf(Bg3SessionsDemoBody) });

const PAGE: GuildPage = {
    guild: { id: -1, gameId: 0, kind: 'wow_guild', name: 'Demo hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 12, lastSnapshotAt: null, gameSlug: DEMO },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

/** The demo bento: the sample widgets as real Overview cells (the Steam pair reads a seeded cache entry). */
export default function HubWidgetsDemo(): JSX.Element {
    const client = useQueryClient();
    useState(() => client.setQueryData(hubSteamStatsKey(PAGE.guild.id), DEMO_STEAM_STATS));
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['ds-hub-widget-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    const cells = gameWidgetCells({ page: PAGE, raids }, ACTIVE);
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cells.map((c) => <div key={c.key} className="contents">{c.node}</div>)}
        </div>
    );
}
