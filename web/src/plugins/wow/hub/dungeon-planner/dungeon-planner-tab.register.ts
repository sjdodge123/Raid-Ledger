/**
 * ROK-2216 — the WoW: Forever guild "Dungeon planner" hub tab (ROK-2207 OQ1).
 * Registered by the Blizzard plugin through `registerHubGameTab` in
 * `../../register.ts` (game scope + plugin-active gating stay core's) and
 * declared in `HUB_PLUGIN_MANIFESTS.blizzard.tabs`, so it disappears with the plugin.
 */
import { lazy } from 'react';
import type { HubCtx, HubTab } from '../../../hub-module';
import { isForeverGuildPage } from '../../lib/forever-identity';
import { DUNGEON_PLANNER_TAB_ID } from './planner-url';

/**
 * Guild hubs only (ROK-2214 Q2 — `registerHubGameTab` scopes by game, not
 * kind, so a Forever `game_community` hub is excluded here). Members, staff
 * and visitors who can see the hub all get it (ROK-2207 OQ8).
 */
export function dungeonPlannerTabVisible({ page }: Pick<HubCtx, 'page'>): boolean {
    return isForeverGuildPage(page);
}

/** The Dungeon planner tab — after Raids (10), before Crafters (15) (ruling 2026-11-16 Q1). */
export const dungeonPlannerTab: HubTab = {
    id: DUNGEON_PLANNER_TAB_ID,
    label: 'Dungeon planner',
    order: 12,
    component: lazy(() => import('./dungeon-planner-tab')),
    visible: dungeonPlannerTabVisible,
};
