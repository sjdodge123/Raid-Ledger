/**
 * ROK-1830 — the WoW guild hub module. Everything the `/guilds/:id` shell
 * cannot know about a WoW guild is declared here and handed to core through
 * `PluginHandle.registerHubModule`; core resolves it by `guild.kind` and drops
 * it the moment the Blizzard plugin is switched off.
 */
import { lazy } from 'react';
import type { HubModule } from '../../hub-module';
import { HiddenTab, WowRaidsTab } from './wow-tabs';
import { WowFactionPill, WowWhereFact } from './wow-hero';
import { wowHeroNote } from './wow-hero.helpers';
import { WowRoleSummaryBand } from './wow-members';
import {
    WOW_MEMBERS_EMPTY,
    WOW_MEMBER_COLUMNS,
    wowMemberGroups,
    wowMemberRowClass,
    wowMembersBlurb,
} from './wow-members.helpers';
import { WowEditorsWidget, WowMembersSummary, WowRoleCompositionWidget } from './wow-widgets';

/**
 * `register.ts` is a boot-time side-effect import, so the addon panel (form,
 * row, URL parser) stays a lazy chunk of the Resources tab, as it was when it
 * lived in core. Core renders `resourceSections` inside a Suspense boundary.
 */
const GuildAddonsSection = lazy(() => import('../guild/guild-addons').then((m) => ({ default: m.GuildAddonsSection })));

export const wowHubModule: HubModule = {
    kind: 'wow_guild',
    tabs: [
        { id: 'raids', label: 'Raids', order: 10, component: WowRaidsTab },
        /** Placeholders from the approved prototype — hidden until their story ships (spec Q3). */
        { id: 'progression', label: 'Progression', order: 20, component: HiddenTab, visible: () => false },
        { id: 'loot', label: 'Loot', order: 30, component: HiddenTab, visible: () => false },
    ],
    overviewWidgets: [
        { id: 'role-composition', order: 50, component: WowRoleCompositionWidget, visible: (ctx) => ctx.raids.data !== undefined },
        { id: 'members-summary', order: 60, component: WowMembersSummary },
        { id: 'editors', order: 80, span: 2, component: WowEditorsWidget, visible: (ctx) => ctx.page.viewer.canManageEditors },
    ],
    memberColumns: WOW_MEMBER_COLUMNS,
    heroPills: [WowWhereFact, WowFactionPill],
    memberGroups: wowMemberGroups,
    membersSummary: WowRoleSummaryBand,
    membersBlurb: wowMembersBlurb,
    membersEmpty: WOW_MEMBERS_EMPTY,
    memberRowClass: wowMemberRowClass,
    heroNote: wowHeroNote,
    eventsJumpTab: 'raids',
    resourceSections: [GuildAddonsSection],
};
