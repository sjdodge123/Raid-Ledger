/**
 * ROK-1830 — the hub module host API.
 *
 * `/guilds/:id` is a game-agnostic shell (`web/src/components/hub/`). Each game
 * plugin contributes the parts only it can know — extra tabs, Overview
 * widgets, member rows/columns and hero pills — by handing a `HubModule` to
 * `PluginHandle.registerHubModule`. Core never imports a plugin's code; it
 * reads the module for the hub's `kind` through `useHubModule`, which (like
 * slots and calendar layers) returns nothing while the owning plugin is off.
 */
import type { ComponentType } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { CreateGuildEditorInput, GuildEditor, GuildMemberRow, GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { usePluginStore } from '../stores/plugin-store';
import { getHubModuleRegistrations } from './plugin-registry';

/** Mirrors the api `GUILD_KINDS` / `guilds.kind` column (ROK-1830 S1). */
export type HubKind = 'wow_guild' | 'game_server';

/** One member of the hub, as the page payload carries it. */
export type HubMemberRow = GuildMemberRow;

/** What every module-provided component receives. */
export interface HubCtx {
    page: GuildPage;
    raids: UseQueryResult<GuildRaidsDto, Error>;
}

export interface HubTab {
    id: string;
    label: string;
    /** Within the module band only — core pins Overview/Members first and Resources last (D7-A). */
    order: number;
    component: ComponentType<HubCtx>;
    /** Omitted = always shown. A hidden tab keeps its slot in the frame but is not rendered. */
    visible?: (ctx: HubCtx) => boolean;
}

export interface HubWidget {
    id: string;
    /** Merged with the core Overview widgets and sorted — core ids sit on 10/20/30/40/70. */
    order: number;
    span?: 1 | 2;
    component: ComponentType<HubCtx>;
    visible?: (ctx: HubCtx) => boolean;
}

/** What a module-provided Resources-tab section receives. */
export interface HubResourceCtx {
    guildId: number;
    canEdit: boolean;
}

/**
 * One section a module appends to core's Resources tab (ROK-1830 r2).
 *
 * `useVisible` is how core decides whether the Resources tab has anything in it
 * without knowing what the section renders or which endpoint feeds it — core
 * calls it inside a per-section probe component, so it may use hooks. Omitted =
 * the section always counts as having content.
 */
export interface HubResourceSection {
    id: string;
    component: ComponentType<HubResourceCtx>;
    useVisible?: (guildId: number) => boolean;
}

/**
 * What the settings sheet hands a module's editor-delegation pickers
 * (ROK-1830 S4). Core owns the editor list, the chips and the mutations; a
 * module only offers the grants its game can express — WoW adds whole ranks,
 * which core knows nothing about.
 */
export interface HubEditorDelegationCtx {
    page: GuildPage;
    editors: readonly GuildEditor[];
    /** A mutation is in flight — disable the pickers. */
    pending: boolean;
    onAdd: (input: CreateGuildEditorInput) => void;
}

/** The band one row belongs to while the Members list is grouped. */
export interface HubMemberGrouping {
    key: string;
    label: string;
    /** Kept stable across the ROK-1830 rename; defaults to `guild-group-<key>`. */
    testId?: string;
}

/**
 * One column of the Members list (ROK-1830 S3b). `header` names it in the
 * desktop table head and labels the cell on the phone cards. A column with
 * `groupBy` also offers core the "Group by <header>" toggle — core bands the
 * rows by the returned key, in first-appearance order, so the module's own row
 * order decides the band order.
 */
export interface HubMemberColumn {
    id: string;
    header: string;
    cell: ComponentType<{ row: HubMemberRow }>;
    groupBy?: (row: HubMemberRow) => HubMemberGrouping;
}

export interface HubModule {
    kind: HubKind;
    tabs: readonly HubTab[];
    overviewWidgets: readonly HubWidget[];
    memberColumns: readonly HubMemberColumn[];
    heroPills: readonly ComponentType<HubCtx>[];
    /** Every member of the hub, in the order the module wants them listed. */
    memberRows: (page: GuildPage) => readonly HubMemberRow[];
    /** Text the Members search box matches a row against. Default: the row's name. */
    memberSearch?: (row: HubMemberRow) => string;
    /** Band above the groups in the Members frame (WoW: role counts). */
    membersSummary?: ComponentType<HubCtx>;
    /** Sub-title under the Members heading. */
    membersBlurb?: (page: GuildPage) => string;
    /** Shown instead of the groups when there are none. */
    membersEmpty?: string;
    /** Left-rule class per member row (WoW: the role colour). */
    memberRowClass?: (row: HubMemberRow) => string;
    /** Line under the hero's next-event chip (WoW: the LedgerLink import line). */
    heroNote?: (ctx: HubCtx) => string | null;
    /**
     * Tab id the hero's next-event chip jumps to. Core's own Events tab owns
     * the Overview "All events" jump (ROK-1830 S3c); this is only the chip, so
     * a module can send "Next raid" at its own tab — WoW points at `raids`,
     * where the next raid's role composition is (approved prototype). Unset =
     * the core Events tab.
     */
    eventsJumpTab?: string;
    /**
     * Rows added to the settings sheet's "Page editors" section (ROK-1830 S4).
     * WoW contributes its rank + member pickers here; the rank-based mapping
     * itself stays WoW-side. Unset = core shows the list with no way to add.
     */
    editorDelegation?: ComponentType<HubEditorDelegationCtx>;
    /** Sections appended under the Resources tab's rules + links (WoW: recommended addons). Core wraps each in Suspense, so a `lazy` component is fine. */
    resourceSections?: readonly HubResourceSection[];
}

export interface HubModuleRegistration {
    pluginSlug: string;
    module: HubModule;
}

/** The module for this hub kind, or `undefined` while its owning plugin is inactive. */
export function useHubModule(kind: string): HubModule | undefined {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const found = getHubModuleRegistrations().find((r) => r.module.kind === kind);
    return found && activeSlugs.has(found.pluginSlug) ? found.module : undefined;
}
