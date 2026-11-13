/**
 * ROK-1790 — the WoW: Forever "Crafters" hub tab (operator ruling 2026-11-12
 * Q1: its own tab, not a Resources section). Registered by the Blizzard
 * plugin through `registerHubGameTab` in `../../register.ts` and declared in
 * `HUB_PLUGIN_MANIFESTS.blizzard.tabs`, so it disappears with the plugin.
 */
import { lazy } from 'react';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type { HubCtx, HubTab } from '../../../hub-module';
import { getCachedUser } from '../../../../hooks/use-auth';
import { queryClient } from '../../../../lib/query-client';
import { rosterInsightsKey } from '../../hub-widgets/use-roster-insights';
import { CRAFTERS_TAB_ID, canSeeCrafters } from './crafters.helpers';

/**
 * `HubTab.visible` is not a hook, so it reads the roster-insights query the
 * Overview professions widget and the Members coverage strip share (same key,
 * spec D1) straight from the cache. Before that query lands the tab shows for
 * members and staff, so a `#crafters` deep link resolves; once it lands with
 * no profession data the tab hides on the next hub render.
 */
export function craftersTabVisible({ page }: HubCtx): boolean {
    const viewer = getCachedUser()?.id ?? 'anon';
    const cached = queryClient.getQueryData<WowRosterInsightsDto>(rosterInsightsKey(page.guild.id, false, viewer));
    return canSeeCrafters(page.viewer, cached);
}

/** The Crafters tab — after Raids (10), before the planned Progression (20). */
export const craftersTab: HubTab = {
    id: CRAFTERS_TAB_ID,
    label: 'Crafters',
    order: 15,
    component: lazy(() => import('./crafters-tab')),
    visible: craftersTabVisible,
};
