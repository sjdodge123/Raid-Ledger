/**
 * ROK-1916 (W9) — registers the WoW: Forever "Last seen" hub Overview widget.
 * Order 87 follows Who's saved (86) with the other members-only cards.
 * Presence is members + staff only: the API omits `lastSeen` for visitors, so
 * `audience` is 'everyone' and `useVisible` gates on the key (a 'members'
 * audience would hide it from non-member staff — see `whos-saved.register.ts`).
 * Always the full roster, so it shares the default roster-insights query.
 */
import { lazy } from 'react';
import type { HubGameWidget, HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { MembersSeeAll } from './see-all-actions';
import { useRosterInsights } from './use-roster-insights';

/** Visible once the roster insights carry a `lastSeen` section (even `reported: 0`). */
export function useLastSeenVisible({ page }: Pick<HubWidgetCtx, 'page'>): boolean {
    const { data } = useRosterInsights(page.guild.id, false);
    return data?.lastSeen !== undefined;
}

/** The Last seen widget definition. */
export const lastSeenWidget: HubGameWidget = {
    id: 'forever-last-seen',
    title: 'Last seen',
    description: 'Who was online at the last roster export, and who has been away longest.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 87,
    span: 1,
    audience: 'everyone',
    action: MembersSeeAll,
    component: lazy(() => import('./last-seen-widget')),
    useVisible: useLastSeenVisible,
};
