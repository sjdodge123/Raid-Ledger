/**
 * ROK-1790 — the WoW: Forever "Crafters" hub tab (operator ruling 2026-11-12
 * Q1: its own tab, not a Resources section). Registered by the Blizzard
 * plugin through `registerHubGameTab` in `../../register.ts` and declared in
 * `HUB_PLUGIN_MANIFESTS.blizzard.tabs`, so it disappears with the plugin.
 */
import { lazy } from 'react';
import type { HubCtx, HubTab } from '../../../hub-module';
import { queryClient } from '../../../../lib/query-client';
import { peekRosterInsights } from '../../hub-widgets/use-roster-insights';
import { CRAFTERS_TAB_ID, canSeeCrafters } from './crafters.helpers';

/**
 * `HubTab.visible` is not a hook, so it reads the roster-insights query the
 * Overview professions widget and the Members coverage strip share (same key,
 * spec D1) straight from the cache. Before that query lands the tab shows for
 * members and staff, so a `#crafters` deep link resolves; once it lands with
 * no profession data the tab hides on the next hub render. The key's viewer
 * scope comes from `peekRosterInsights`, the same source the data hook uses.
 */
export function craftersTabVisible({ page }: Pick<HubCtx, 'page'>): boolean {
    return canSeeCrafters(page.viewer, peekRosterInsights(queryClient, page.guild.id));
}

/** The Crafters tab — after Raids (10), before the planned Progression (20). */
export const craftersTab: HubTab = {
    id: CRAFTERS_TAB_ID,
    label: 'Crafters',
    order: 15,
    component: lazy(() => import('./crafters-tab')),
    visible: craftersTabVisible,
};
