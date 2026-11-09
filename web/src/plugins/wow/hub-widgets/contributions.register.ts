/**
 * ROK-2148 — registers the WoW: Forever "Guild contributions" hub Overview
 * card: profession masters from the Mailworthy guild template, the top givers
 * of guild-rule mail (30 days / All time) and who runs Mailworthy. The probe
 * hides it unless the read loads (members + staff; the api 403s the rest).
 */
import { lazy } from 'react';
import type { HubGameWidget } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useContributionsVisible } from '../hooks/use-guild-contributions';

/** Never rename the id (saved layout key `plugin:blizzard:forever-guild-contributions`). */
export const contributionsWidget: HubGameWidget = {
    id: 'forever-guild-contributions',
    title: 'Guild contributions',
    description: 'Profession masters, top givers of guild-rule mail, and who runs Mailworthy.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 86,
    span: 1,
    audience: 'everyone',
    useVisible: useContributionsVisible,
    component: lazy(() => import('./contributions-widget')),
};
