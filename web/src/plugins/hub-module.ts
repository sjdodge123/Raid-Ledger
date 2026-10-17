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
import type { GuildMemberRow, GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
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

/** One cell of a member row, rendered in `memberColumns` order. */
export interface HubMemberColumn {
    id: string;
    cell: ComponentType<{ row: HubMemberRow }>;
}

/** A collapsible band of members (WoW: one guild rank). */
export interface HubMemberGroup {
    key: string;
    label: string;
    testId: string;
    defaultOpen: boolean;
    rows: readonly HubMemberRow[];
}

export interface HubModule {
    kind: HubKind;
    tabs: readonly HubTab[];
    overviewWidgets: readonly HubWidget[];
    memberColumns: readonly HubMemberColumn[];
    heroPills: readonly ComponentType<HubCtx>[];
    /** Rows arrive already grouped per kind; empty groups are dropped by the module. */
    memberGroups: (page: GuildPage) => readonly HubMemberGroup[];
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
     * Tab id the hero's next-event chip and the Overview events widget jump to
     * (WoW: `raids`). Unset = no jump, so a module without an events tab never
     * renders a dead chip.
     */
    eventsJumpTab?: string;
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
