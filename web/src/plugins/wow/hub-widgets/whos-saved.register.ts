/**
 * ROK-1914 (W6, plan H14) — registers the WoW: Forever "Who's saved" hub
 * Overview widget. Members + staff only: the API omits `lockouts` for
 * visitors, so `audience` is 'everyone' and `useVisible` gates on the key
 * (a 'members' audience would hide it from non-member staff), as Guild
 * professions does. An empty array shows the empty state. Always the full
 * roster (D4), so it shares the professions query.
 */
import { lazy } from 'react';
import type { HubGameWidget, HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useRosterInsights } from './use-roster-insights';

/** Visible once the roster insights carry a `lockouts` array (possibly empty). */
export function useWhosSavedVisible({ page }: Pick<HubWidgetCtx, 'page'>): boolean {
    const { data } = useRosterInsights(page.guild.id, false);
    return data?.lockouts !== undefined;
}

/** The Who's saved widget definition. */
export const whosSavedWidget: HubGameWidget = {
    id: 'forever-whos-saved',
    title: "Who's saved",
    description: 'Who is saved to which instance, and when it resets.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 86,
    span: 1,
    audience: 'everyone',
    component: lazy(() => import('./whos-saved-widget')),
    useVisible: useWhosSavedVisible,
};
