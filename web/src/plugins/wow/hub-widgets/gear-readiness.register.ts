/**
 * ROK-1915 (W7 + W8) — registers the WoW: Forever "Gear readiness" hub
 * Overview widget. Order 88 follows Last seen (87) with the other
 * members-only cards. Gear is members + staff only: the API omits `gear` for
 * visitors, so `audience` is 'everyone' and `useVisible` gates on the key (a
 * 'members' audience would hide it from non-member staff — see
 * `whos-saved.register.ts`). Always the full roster, so it shares the default
 * roster-insights query.
 */
import { lazy } from 'react';
import type { HubGameWidget, HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { MembersSeeAll } from './see-all-actions';
import { useRosterInsights } from './use-roster-insights';

/** Visible once the roster insights carry a `gear` section (even an empty one). */
export function useGearReadinessVisible({ page }: Pick<HubWidgetCtx, 'page'>): boolean {
    const { data } = useRosterInsights(page.guild.id, false);
    return data?.gear !== undefined;
}

/** The Gear readiness widget definition. */
export const gearReadinessWidget: HubGameWidget = {
    id: 'forever-gear-readiness',
    title: 'Gear readiness',
    description: 'Average item level of level-60 mains, and who is missing enchants.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 88,
    span: 1,
    audience: 'everyone',
    action: MembersSeeAll,
    component: lazy(() => import('./gear-readiness-widget')),
    useVisible: useGearReadinessVisible,
};
