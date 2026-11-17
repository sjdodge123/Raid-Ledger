/**
 * ROK-2212 — registers the WoW: Forever "Suggested groups" Overview card on
 * guild hubs: the best group of five for each of the 3 best dungeons. Anyone
 * who can see the hub sees it (ruling 6, like the planner tab); the body hides
 * Schedule + Poll from visitors. Order 43 is free among the Forever widgets.
 * "See all" jumps to the Dungeon planner tab, whose Suggested groups section
 * lists every lineup (ruling 7). Self-hides while there are no groups.
 */
import { lazy } from 'react';
import type { HubGameWidget, HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useSuggestedGroups } from '../hub/suggested-groups/use-suggested-groups';
import { SuggestedGroupsSeeAll } from './see-all-actions';

/** `useVisible`: the (shared, cached) top query has at least one group. */
export function useSuggestedGroupsVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useSuggestedGroups(page.guild.id);
    return (data?.groups.length ?? 0) > 0;
}

/** Never rename the id (saved layout key `plugin:blizzard:forever-suggested-groups`). */
export const suggestedGroupsWidget: HubGameWidget = {
    id: 'forever-suggested-groups',
    title: 'Suggested groups',
    description: "Groups of five that fit a dungeon's level range and roles.",
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 43,
    span: 2,
    audience: 'everyone',
    action: SuggestedGroupsSeeAll,
    useVisible: useSuggestedGroupsVisible,
    component: lazy(() => import('./suggested-groups-widget')),
};
