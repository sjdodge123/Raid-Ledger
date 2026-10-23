/**
 * ROK-1923 (epic ROK-1905 H8) — registers the WoW: Forever "Guild professions"
 * hub Overview widget (W4). Members + staff only: the API omits `professions`
 * for visitors, so `audience` is 'everyone' and `useVisible` does the gating
 * (a 'members' audience would hide it from non-member staff). The card hides when the payload has no
 * `professions` key and shows the empty state when the array is empty.
 */
import { lazy } from 'react';
import type { HubGameWidget, HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useRosterInsights } from './use-roster-insights';

/** Visible once the roster insights carry a `professions` array (possibly empty). */
export function useProfessionsVisible({ page }: Pick<HubWidgetCtx, 'page'>): boolean {
    const { data } = useRosterInsights(page.guild.id);
    return data?.professions !== undefined;
}

/** The Guild professions widget definition. */
export const professionsWidget: HubGameWidget = {
    id: 'forever-professions',
    title: 'Guild professions',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 85,
    span: 1,
    audience: 'everyone',
    component: lazy(() => import('./professions-widget')),
    useVisible: useProfessionsVisible,
};
