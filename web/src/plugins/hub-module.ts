/**
 * ROK-1830 — the hub module host API.
 *
 * `/hubs/:id` is a game-agnostic shell (`web/src/components/hub/`). Each game
 * plugin contributes the parts only it can know — extra tabs, Overview
 * widgets, member rows/columns and hero pills — by handing a `HubModule` to
 * `PluginHandle.registerHubModule`. Core never imports a plugin's code; it
 * reads the module for the hub's `kind` through `useHubModule`, which (like
 * slots and calendar layers) returns nothing while the owning plugin is off.
 */
import type { ComponentType, ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { CreateGuildEditorInput, GuildEditor, GuildKind, GuildMemberRow, GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { usePluginStore } from '../stores/plugin-store';
import { getHubModuleRegistrations } from './plugin-registry';
import {
    COMMUNITY_HUB_KIND, retryCommunityHubModule, useCommunityHubModule, useCommunityHubModuleError,
} from '../components/hub/community/community-hub-module-loader';

/** The api `GUILD_KINDS` / `guilds.kind` column (ROK-1830 S1; `game_community` since ROK-1870). */
export type HubKind = GuildKind;

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
    /** Within the module band only — core pins Overview/Members/Events/Resources first (ROK-1876). */
    order: number;
    component: ComponentType<HubCtx>;
    /** Omitted = always shown. A hidden tab keeps its slot in the frame but is not rendered. */
    visible?: (ctx: HubCtx) => boolean;
}

/** ROK-1831: the core Overview widgets a module may hide (`HubModule.coreWidgetVisible`). */
export type CoreWidgetId = 'gm-post' | 'discord' | 'schedule' | 'events' | 'attendance';

export interface HubWidget {
    id: string;
    /** ROK-1918 — the widget's name in arrange mode. Omitted = the humanised id. */
    title?: string;
    /** ROK-1918 — one line for the arrange list and the Add picker. */
    description?: string;
    /** ROK-1918 — `false` = opt-in (hidden until an editor adds it). Default `true`. */
    defaultOn?: boolean;
    /** Default slot among the core Overview widgets (10/20/30/40/70); a hub's saved layout overrides it. */
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
 * One game's source for core's "Recommended mods" frame on the Resources tab
 * (ROK-1830 S5b, D8-B — it was `resourceSections` in r2, when the WoW addon
 * panel owned its own heading).
 *
 * `useVisible` is how core decides whether the frame — and with it the
 * Resources tab — has anything in it without knowing what the source renders
 * or which endpoint feeds it: core calls it inside a per-source probe
 * component, so it may use hooks. Omitted = the source always counts as having
 * content. `label` heads the band and is only drawn once a hub has more than
 * one source.
 */
export interface HubModSource {
    id: string;
    label: string;
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
 * desktop table head ONLY — a phone card shows the first column as the row's
 * identity line and wraps the rest into one unlabelled meta line, so every
 * cell must read on its own (a column whose `cell` can render `null`, such as
 * WoW's Main/Raid role, would otherwise leave an orphan label). A column with
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

/**
 * ROK-1173 — one "Sort by" option of the Members list. `compare` orders two
 * rows; core breaks ties by name, so a sort never reshuffles equal rows. Core
 * always offers the module's own row order first (id `rank`, the default) and
 * Name A–Z / Z–A; `HubModule.memberSorts` appends the rest.
 */
export interface HubMemberSort {
    id: string;
    label: string;
    /** Omitted = the module's row order (only the default option does this). */
    compare?: (a: HubMemberRow, b: HubMemberRow) => number;
}

/**
 * ROK-1173 — what a module's `useMemberFilters` hook hands the Members frame.
 * Core owns the opener (funnel at 1024px and up, Filters FAB + sheet below),
 * the search box, the sort and the flat/grouped switch; the module owns the
 * filter state and these values.
 */
export interface HubMemberFilters {
    /** Active filter groups (values differing from the defaults) — the funnel/FAB badge. 0 = no filters. */
    activeCount: number;
    /** True when the row passes every active filter (AND across groups, OR within one). */
    matches: (row: HubMemberRow) => boolean;
    /** "Clear all" — resets the filters only (not the search or the sort). */
    clearAll: () => void;
    /** The filter controls, rendered inside `FilterEntry` (inline panel or bottom sheet). */
    controls: ReactNode;
    /** Optional block between the toolbar and the list (WoW: the profession coverage strip). */
    lead?: ReactNode;
}

export interface HubModule {
    kind: HubKind;
    tabs: readonly HubTab[];
    overviewWidgets: readonly HubWidget[];
    /** ROK-1831: hide a core Overview widget for this viewer (members-first privacy). Omitted = every core widget shows. */
    coreWidgetVisible?: (id: CoreWidgetId, ctx: HubCtx) => boolean;
    memberColumns: readonly HubMemberColumn[];
    heroPills: readonly ComponentType<HubCtx>[];
    /** Every member of the hub, in the order the module wants them listed. */
    memberRows: (page: GuildPage) => readonly HubMemberRow[];
    /** ROK-1173: extra "Sort by" options after core's default order + Name A–Z / Z–A (see `MEMBER_SORT_PRESETS`). */
    memberSorts?: readonly HubMemberSort[];
    /**
     * ROK-1173: the Members filter state, as a React hook. Core calls it once
     * per render of the Members frame with every row the module listed (the
     * frame remounts when the module changes, so the hook order is stable).
     */
    useMemberFilters?: (ctx: HubCtx, rows: readonly HubMemberRow[]) => HubMemberFilters;
    /** Text the Members search box matches a row against. Default: the row's name. */
    memberSearch?: (row: HubMemberRow) => string;
    /** Band above the groups in the Members frame (WoW: role counts). */
    membersSummary?: ComponentType<HubCtx>;
    /** Block above the core Events tab widgets (ROK-1893 P3, community hubs: Open polls). Lives in the module's own chunk. */
    eventsLead?: ComponentType<HubCtx>;
    /** Sub-title under the Members heading. */
    membersBlurb?: (page: GuildPage) => string;
    /** Shown instead of the groups when there are none (a function can read the page, e.g. visitor vs member). */
    membersEmpty?: string | ((page: GuildPage) => string);
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
    /** Sources of the core "Recommended mods" frame under the Resources tab's rules + links (WoW: its addon panel). Core wraps each in Suspense, so a `lazy` component is fine. */
    modSources?: readonly HubModSource[];
    /**
     * ROK-1870 — a per-row action menu on the Members tab (community hubs:
     * remove / ban / promote / demote). Core appends it as a trailing,
     * header-less column; the component decides per row whether to render.
     */
    memberActions?: ComponentType<{ row: HubMemberRow; ctx: HubCtx }>;
    /**
     * ROK-1870 — extra sections at the bottom of the settings sheet (community
     * hubs: blurb, Banned list, Archive / Restore). The component gates its own
     * rows on the viewer's role.
     */
    settingsSections?: ComponentType<HubCtx>;
}

export interface HubModuleRegistration {
    pluginSlug: string;
    module: HubModule;
}

/**
 * The module for this hub kind, or `undefined` while its owning plugin is
 * inactive. `game_community` is core-owned (ROK-1870 A4): it returns once its
 * lazy chunk has loaded (`useHubModulePending` is true until then).
 */
export function useHubModule(kind: string): HubModule | undefined {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const community = useCommunityHubModule(kind === COMMUNITY_HUB_KIND);
    if (kind === COMMUNITY_HUB_KIND) return community;
    const found = getHubModuleRegistrations().find((r) => r.module.kind === kind);
    return found && activeSlugs.has(found.pluginSlug) ? found.module : undefined;
}

/** True while this hub kind's module is still being fetched (only the lazy core `game_community` module ever is). */
export function useHubModulePending(kind: string | undefined): boolean {
    const wanted = kind === COMMUNITY_HUB_KIND;
    const mod = useCommunityHubModule(wanted);
    const error = useCommunityHubModuleError(wanted);
    return wanted && mod === undefined && error === undefined;
}

/** The lazy core module's load failure, if any — the page shows it with a retry instead of a skeleton. */
export function useHubModuleLoadError(kind: string | undefined): Error | undefined {
    return useCommunityHubModuleError(kind === COMMUNITY_HUB_KIND);
}

/** Retry a failed lazy core-module load. */
export const retryHubModuleLoad: () => void = retryCommunityHubModule;
