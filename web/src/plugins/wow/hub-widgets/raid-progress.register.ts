/**
 * ROK-1917 (W10) — registers the WoW: Forever "Raid progress" hub Overview
 * widget. Order 89 follows Gear readiness (88) with the other members-only
 * cards; span 2 (core clamps it to 1 on a phone). Raid progress is members +
 * staff only: the API omits `raidProgress` for visitors, so `audience` is
 * 'everyone' and `useVisible` gates on the key (see `gear-readiness.register.ts`).
 * No "See all" action: no hub tab holds boss progress, and the card already
 * expands to the full boss list in place ("N more bosses").
 */
import { lazy } from 'react';
import type { HubGameWidget, HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useRosterInsights } from './use-roster-insights';

/** Visible once the roster insights carry a `raidProgress` section (even an empty one). */
export function useRaidProgressVisible({ page }: Pick<HubWidgetCtx, 'page'>): boolean {
    const { data } = useRosterInsights(page.guild.id, false);
    return data?.raidProgress !== undefined;
}

/** The Raid progress widget definition. */
export const raidProgressWidget: HubGameWidget = {
    id: 'forever-raid-progress',
    title: 'Raid progress',
    description: 'First kills, kills and wipes per raid boss.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 89,
    span: 2,
    audience: 'everyone',
    component: lazy(() => import('./raid-progress-widget')),
    useVisible: useRaidProgressVisible,
};
