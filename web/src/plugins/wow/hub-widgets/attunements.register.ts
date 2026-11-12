/**
 * ROK-1927 (W13) — registers the WoW: Forever "Attunements" hub Overview card
 * (order 90, span 1 — ruling Q9). Quests are members + staff only: the API
 * omits `attunements` for visitors, so `audience` is 'everyone' and
 * `useVisible` gates on the key (a 'members' audience would hide it from
 * non-member staff — see `whos-saved.register.ts`). Shares the default
 * roster-insights query with the other Forever roster cards.
 */
import { lazy } from 'react';
import type { HubGameWidget, HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { AttunementsAction } from './attunements-action';
import { useRosterInsights } from './use-roster-insights';

/** Visible once the roster insights carry an `attunements` section (even an empty one). */
export function useAttunementsVisible({ page }: Pick<HubWidgetCtx, 'page'>): boolean {
    const { data } = useRosterInsights(page.guild.id, false);
    return data?.attunements !== undefined;
}

/** The Attunements widget definition. Never rename the id (saved layout key `plugin:blizzard:forever-attunements`). */
export const attunementsWidget: HubGameWidget = {
    id: 'forever-attunements',
    title: 'Attunements',
    description: 'Who is attuned to each raid, and who is still working through the chain.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 90,
    span: 1,
    audience: 'everyone',
    action: AttunementsAction,
    component: lazy(() => import('./attunements-widget')),
    useVisible: useAttunementsVisible,
};
