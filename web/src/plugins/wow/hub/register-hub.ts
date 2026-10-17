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
    wowMemberRowClass,
    wowMemberRows,
    wowMemberSearch,
    wowMembersBlurb,
} from './wow-members.helpers';
import { WowMembersSummary, WowRoleCompositionWidget } from './wow-widgets';
import { WowEditorDelegation } from './editor-delegation';
import { useWowAddonsVisible } from './wow-resources.helpers';

/**
 * `register.ts` is a boot-time side-effect import, so the addon panel (form,
 * row, URL parser) stays a lazy chunk of the Resources tab, as it was when it
 * lived in core. Core renders each `modSources` entry inside a Suspense
 * boundary, in its "Recommended mods" frame (ROK-1830 S5b).
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
    ],
    memberColumns: WOW_MEMBER_COLUMNS,
    heroPills: [WowWhereFact, WowFactionPill],
    memberRows: wowMemberRows,
    memberSearch: wowMemberSearch,
    membersSummary: WowRoleSummaryBand,
    membersBlurb: wowMembersBlurb,
    membersEmpty: WOW_MEMBERS_EMPTY,
    memberRowClass: wowMemberRowClass,
    heroNote: wowHeroNote,
    eventsJumpTab: 'raids',
    editorDelegation: WowEditorDelegation,
    modSources: [{ id: 'wow-addons', label: 'World of Warcraft addons', component: GuildAddonsSection, useVisible: useWowAddonsVisible }],
};
