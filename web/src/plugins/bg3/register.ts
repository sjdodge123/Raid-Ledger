/**
 * ROK-1958 D-1 / D-3 — the Baldur's Gate 3 web plugin. The slug matches the
 * api manifest id `bg3` (ROK-1957 D-1); every registration is declared in
 * `HUB_PLUGIN_MANIFESTS.bg3` (ROK-1969 ownership guards).
 *
 * Three Overview cards on `game_community` hubs of a BG3 game (any slug in
 * `BG3_GAME_SLUGS`, ROK-2038) — Where we are
 * (35, span 1) + Party (36, span 2) share a desktop row above Events (40; operator 2026-10-28), Session history (46,
 * span 2) sits before Gallery (47). `audience: 'everyone'` plus a
 * members-or-staff `useVisible` probe, because the api lets non-member staff
 * read (ROK-1957 D-15; precedent `wow/hub-widgets/dungeon-quests.register.ts`).
 */
import { BG3_GAME_SLUGS } from '@raid-ledger/contract';
import type { HubCtx } from '../hub-module';
import { registerPlugin } from '../plugin-registry';
import { getCachedUser, isOperatorOrAdmin } from '../../hooks/use-auth';
import { LazyBg3WhereWidget } from './hub/bg3-where-widget-lazy';
import { LazyBg3PartyWidget } from './hub/bg3-party-widget-lazy';
import { LazyBg3SessionsWidget } from './hub/bg3-sessions-widget-lazy';
import { Bg3CampaignAction, Bg3SeeAllAction } from './hub/bg3-see-all-action';
import { LazyBg3CampaignTab } from './campaign/bg3-campaign-tab-lazy';
import { useBg3PartyVisible, useBg3SnapshotVisible } from './hooks/use-bg3-visible';

/** Neutral registry colour, like Valheim. */
const bg3 = registerPlugin('bg3', {
    icon: '🎲',
    color: '#64748B',
    label: "Baldur's Gate 3",
});

const CARD = {
    games: [...BG3_GAME_SLUGS],
    kinds: ['game_community'],
    defaultOn: true,
    audience: 'everyone',
} as const;

bg3.registerHubWidget({
    ...CARD,
    id: 'where-we-are',
    title: 'Where we are',
    description: "The party's latest save: area, screenshot and when it was saved.",
    order: 35,
    span: 1,
    component: LazyBg3WhereWidget,
    useVisible: useBg3SnapshotVisible,
});

// Party stays visible with no campaign — its empty state is the binding entry point (D-10).
bg3.registerHubWidget({
    ...CARD,
    id: 'party',
    title: 'Party',
    description: 'Who plays which character, their levels and the roles the party covers.',
    order: 36,
    span: 2,
    component: LazyBg3PartyWidget,
    action: Bg3CampaignAction,
    useVisible: useBg3PartyVisible,
});

bg3.registerHubWidget({
    ...CARD,
    id: 'session-history',
    title: 'Session history',
    description: 'Recent play sessions: when, how long, levels gained and areas visited.',
    order: 46,
    span: 2,
    component: LazyBg3SessionsWidget,
    action: Bg3SeeAllAction,
    useVisible: useBg3SnapshotVisible,
});

/**
 * Community hubs only — the api refuses every campaign route on other kinds
 * (`refuseNonBg3Hub`), and `registerHubGameTab` matches the game on every kind.
 * `visible` is not a hook, so staff come from the cached user (the read routes enforce access anyway).
 */
const campaignTabVisible = ({ page }: HubCtx): boolean =>
    page.guild.kind === 'game_community'
    && (page.viewer.role !== 'visitor' || isOperatorOrAdmin(getCachedUser()));

// D-3 — campaigns, your saves, history and the editor settings (no hub-settings slot for game plugins).
bg3.registerHubGameTab([...BG3_GAME_SLUGS], {
    id: 'campaign',
    label: 'Campaign',
    order: 40,
    component: LazyBg3CampaignTab,
    visible: campaignTabVisible,
});
