/**
 * ROK-1830 — the WoW guild hub module. Everything the `/guilds/:id` shell
 * cannot know about a WoW guild is declared here and handed to core through
 * `PluginHandle.registerHubModule`; core resolves it by `guild.kind` and drops
 * it the moment the Blizzard plugin is switched off.
 */
import type { HubModule } from '../../hub-module';
import { HiddenTab, WowRaidsTab } from './wow-tabs';
import { WowFactionPill, WowWhereFact, wowHeroNote } from './wow-hero';
import {
    WOW_MEMBERS_EMPTY,
    WOW_MEMBER_COLUMNS,
    WowRoleSummaryBand,
    wowMemberGroups,
    wowMemberRowClass,
    wowMembersBlurb,
} from './wow-members';
import { WowEditorsWidget, WowMembersSummary, WowRoleCompositionWidget } from './wow-widgets';

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
};
