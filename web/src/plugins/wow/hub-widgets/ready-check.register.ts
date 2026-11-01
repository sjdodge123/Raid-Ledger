/**
 * ROK-1926 (epic ROK-1905 W11 ★ / H18) — registers the WoW: Forever "Ready for
 * next run" card on guild hub Overviews. Order 44 makes it the first Forever
 * card (operator ruling 2026-11-01, rec 1); span 2 (rec 3). Same gate as
 * Dungeon quests: `audience` 'everyone' + `useVisible` = (not a visitor OR
 * staff) AND an upcoming guild event has planned content — so a visitor never
 * mounts the body and the card hides when there is no such event (rec 2).
 * Lazy body (app-entry budget).
 */
import { lazy } from 'react';
import type { PluginHandle } from '../../plugin-registry';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useDungeonQuestsVisible } from './dungeon-quests.register';
import { EventsSeeAll } from './see-all-actions';

const ReadyCheckWidget = lazy(() => import('./ready-check-widget'));

/** Add the Ready for next run widget to the WoW plugin. */
export function registerReadyCheckWidget(plugin: PluginHandle): void {
    plugin.registerHubWidget({
        id: 'forever-ready-check',
        title: 'Ready for next run',
        description: 'Whether everyone signed up for the next raid or dungeon meets its level, quests, lockout and item level.',
        games: [WOW_FOREVER_GAME_SLUG],
        kinds: ['wow_guild'],
        order: 44,
        span: 2,
        audience: 'everyone',
        component: ReadyCheckWidget,
        action: EventsSeeAll,
        useVisible: useDungeonQuestsVisible,
    });
}
