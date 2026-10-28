/**
 * ROK-1919 (W12, plan H21) — registers the WoW: Forever "Recent dings" hub
 * Overview widget. Order 49 follows Dungeon quests (48) in the Forever 45-49
 * slot. Level is public (ROK-1905 Q2), so every hub viewer sees it — no
 * `useVisible` probe: an empty feed shows the empty state and its hint.
 */
import { lazy } from 'react';
import type { HubGameWidget } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';

/** The Recent dings widget definition. */
export const recentDingsWidget: HubGameWidget = {
    id: 'forever-recent-dings',
    title: 'Recent dings',
    description: 'Who levelled up in the last 30 days.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 49,
    span: 1,
    audience: 'everyone',
    component: lazy(() => import('./recent-dings-widget')),
};
