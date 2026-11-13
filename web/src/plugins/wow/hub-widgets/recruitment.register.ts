/**
 * ROK-1789 — registers the WoW: Forever "Recruitment" hub Overview card:
 * whether the guild is recruiting, the wanted classes + roles with their own
 * state, and the Apply link. Order 14 sits after the Guild message (12) and
 * before "Before next session" (15). Forever-only by `games` (ruling A3);
 * `audience: 'everyone'` + the probe — the api answers 403 to non-members, so
 * the card shows only to members/staff with something set, or to editors.
 */
import { lazy } from 'react';
import type { HubGameWidget } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useRecruitmentVisible } from '../hooks/use-guild-recruitment';
import { RecruitmentAction } from './recruitment-action';

/** The Recruitment widget definition. Never rename the id (saved layout key `plugin:blizzard:forever-recruitment`). */
export const recruitmentWidget: HubGameWidget = {
    id: 'forever-recruitment',
    title: 'Recruitment',
    description: 'Whether the guild is recruiting, which classes and roles it wants, and where to apply.',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    order: 14,
    span: 1,
    audience: 'everyone',
    action: RecruitmentAction,
    useVisible: useRecruitmentVisible,
    component: lazy(() => import('./recruitment-widget')),
};
