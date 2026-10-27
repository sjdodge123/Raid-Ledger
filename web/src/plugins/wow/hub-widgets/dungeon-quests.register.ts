/**
 * ROK-1924 (epic ROK-1905 H10 / W5) — registers the WoW: Forever "Dungeon
 * quests" card on guild hub Overviews. Members + staff: the readiness endpoint
 * lets guild members and staff in, so `audience` is 'everyone' and `useVisible`
 * gates (a 'members' audience would hide it from non-member staff, as e84f83da8
 * fixed for professions). Order 48 sits in the Forever 45-49 band (plan §2.2).
 * Lazy body (app-entry budget); it self-hides unless an upcoming guild event
 * has planned content.
 */
import { lazy } from 'react';
import type { PluginHandle } from '../../plugin-registry';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { isOperatorOrAdmin, useAuth } from '../../../hooks/use-auth';
import { hasContentEvents } from './dungeon-quests.helpers';
import { EventsSeeAll } from './see-all-actions';

const DungeonQuestsWidget = lazy(() => import('./dungeon-quests-widget'));

/** `useVisible`: members or staff, and the guild raids query (already loaded) has a content event. */
export function useDungeonQuestsVisible({ page, raids }: HubWidgetCtx): boolean {
    const { user } = useAuth();
    const allowed = page.viewer.role !== 'visitor' || isOperatorOrAdmin(user);
    return allowed && hasContentEvents(raids.data);
}

/** Add the Dungeon quests widget to the WoW plugin. */
export function registerDungeonQuestsWidget(plugin: PluginHandle): void {
    plugin.registerHubWidget({
        id: 'dungeon-quests',
        title: 'Dungeon quests',
        description: 'Who has the quests for upcoming dungeon runs.',
        games: [WOW_FOREVER_GAME_SLUG],
        kinds: ['wow_guild'],
        order: 48,
        span: 2,
        audience: 'everyone',
        component: DungeonQuestsWidget,
        action: EventsSeeAll,
        useVisible: useDungeonQuestsVisible,
    });
}
