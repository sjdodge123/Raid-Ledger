/**
 * ROK-1921 (epic ROK-1905 H6) — registers the WoW: Forever Class breakdown (W1)
 * and Level progression (W2) widgets on Forever guild hubs. Bodies are lazy so
 * `register.ts` stays light; both hide themselves on an empty roster. Class and
 * level are public (operator ruling Q2), so the audience is everyone.
 */
import { lazy } from 'react';
import type { PluginHandle } from '../../plugin-registry';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { hasRoster } from './class-level.helpers';
import { useRosterInsights } from './use-roster-insights';
import { MembersSeeAll } from './see-all-actions';

/** `useVisible` probe: shown only once the (full) roster has a row. Shares the bodies' default query. */
function useHasRoster(ctx: HubWidgetCtx): boolean {
    return hasRoster(useRosterInsights(ctx.page.guild.id).data);
}

/** Adds W1 (order 45, span 1) and W2 (order 46, span 2) to the plugin's hub widgets. */
export function registerClassLevelWidgets(handle: PluginHandle): void {
    const base = { games: [WOW_FOREVER_GAME_SLUG], kinds: ['wow_guild'] as const, audience: 'everyone' as const, useVisible: useHasRoster };
    handle.registerHubWidget({
        ...base, id: 'forever-class-breakdown', title: 'Class breakdown', order: 45, span: 1,
        description: 'How many members play each class.',
        component: lazy(() => import('./class-breakdown-widget')),
    });
    handle.registerHubWidget({
        ...base, id: 'forever-level-progression', title: 'Level progression', order: 46, span: 2,
        description: 'Where the roster’s levels sit and who is at cap.',
        action: MembersSeeAll,
        component: lazy(() => import('./level-progression-widget')),
    });
}
