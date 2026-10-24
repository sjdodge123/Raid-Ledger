/**
 * ROK-1924 (epic ROK-1905 H10 / W5) — registers the WoW: Forever "Dungeon
 * quests" card on guild hub Overviews. Members only: the readiness endpoint is
 * member-gated, so visitors never mount it. Lazy body (app-entry budget); it
 * self-hides unless an upcoming guild event has planned content.
 */
import { lazy } from 'react';
import type { PluginHandle } from '../../plugin-registry';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { hasContentEvents } from './dungeon-quests.helpers';

const DungeonQuestsWidget = lazy(() => import('./dungeon-quests-widget'));

/** `useVisible`: reads the guild raids query the hub already loads — no extra fetch. */
function useHasContentEvents({ raids }: HubWidgetCtx): boolean {
    return hasContentEvents(raids.data);
}

/** Add the Dungeon quests widget to the WoW plugin. */
export function registerDungeonQuestsWidget(plugin: PluginHandle): void {
    plugin.registerHubWidget({
        id: 'dungeon-quests',
        title: 'Dungeon quests',
        description: 'Who has the quests for upcoming dungeon runs.',
        games: [WOW_FOREVER_GAME_SLUG],
        kinds: ['wow_guild'],
        order: 55,
        span: 2,
        audience: 'members',
        component: DungeonQuestsWidget,
        useVisible: useHasContentEvents,
    });
}
