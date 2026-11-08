/**
 * ROK-2136 — registers the WoW: Forever "Guild message" hub Overview card: the
 * guild Message of the Day and Guild Information, each with "Copy for in-game".
 * Order 12 sits after the leader post (10) and before "Before next session"
 * (15). Members + staff only (in game only guild members see them); the route
 * enforces it server-side. Forever-only by the `games` filter — the api checks
 * `wow_guild` alone (operator rulings 2026-11-08, OQ-1/OQ-3/OQ-9).
 */
import { lazy } from 'react';
import type { HubGameWidget } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useGuildTextVisible } from '../hooks/use-guild-ingame-text';
import { GuildTextAction } from './guild-text-action';

/** The Guild message widget definition. Never rename the id (saved layout key `plugin:blizzard:forever-guild-text`). */
export const guildTextWidget: HubGameWidget = {
    id: 'forever-guild-text',
    title: 'Guild message',
    description: 'The guild Message of the Day and Guild Information, ready to paste in game.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 12,
    span: 1,
    audience: 'members',
    action: GuildTextAction,
    useVisible: useGuildTextVisible,
    component: lazy(() => import('./guild-text-widget')),
};
