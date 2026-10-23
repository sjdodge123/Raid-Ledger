/**
 * ROK-1922 (epic ROK-1905 W3) — registers the WoW: Forever Role breakdown
 * widget on Forever guild hubs. Order 47 sits in the Forever 45-49 slot above
 * role composition (plan §2.2). Role is public (operator ruling Q2), so every
 * viewer sees it; it hides itself until someone eligible has a known role.
 */
import { lazy } from 'react';
import type { PluginHandle } from '../../plugin-registry';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useRosterInsights } from './use-roster-insights';
import { hasKnownRoles } from './roles.helpers';

/** `useVisible` probe: shown once roster insights report at least one known role. */
export function useRolesWidgetVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useRosterInsights(page.guild.id);
    return data !== undefined && hasKnownRoles(data.roles);
}

/** Adds the Role breakdown widget to the given (WoW) plugin. */
export function registerRolesWidget(plugin: PluginHandle): void {
    plugin.registerHubWidget({
        id: 'forever-roles',
        title: 'Role breakdown',
        games: [WOW_FOREVER_GAME_SLUG],
        kinds: ['wow_guild'],
        order: 47,
        span: 1,
        audience: 'everyone',
        component: lazy(() => import('./roles-widget')),
        useVisible: useRolesWidgetVisible,
    });
}
