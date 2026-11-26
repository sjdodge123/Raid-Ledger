/**
 * ROK-2352 — the `lfg-grouping` seam: a plugin splits one game's LFG into
 * several groups (`(gameId, groupKey)`) and renders the extra UI for them.
 *
 * Core treats the group key as OPAQUE. Only an ACTIVE plugin's registration
 * for the page's game slug is ever returned, so a game with no grouping (every
 * non-WoW game, or WoW with its plugin off) renders exactly today's page.
 * Registered through `PluginHandle.registerLfgGrouping`; the ownership guard
 * (`hub-plugin-ownership.guard.test.ts`) pins each registration to an
 * `lfg-grouping` behaviour of its own plugin's manifest.
 */
import type { ComponentType } from 'react';
import type {
    LfgGroupDetailDto,
    LfgGroupListItemDto,
    LfgMemberDto,
} from '@raid-ledger/contract';
import { usePluginStore } from '../stores/plugin-store';

/** What every grouping component is told about the page it renders on. */
export interface LfgGroupingContext {
    gameId: number;
    gameSlug: string;
    /** The group the page shows — `''` is the whole-game ("Any") group. */
    groupKey: string;
    /** `?hub=<id>` from the URL, or null (§3.6 — the URL is the source of truth). */
    hubId: number | null;
}

/** The plugin's raise-hand answer: one `POST /lfg` per key, same detail on each. */
export interface LfgRaiseHandSelection {
    /** Groups to raise a hand in. Empty = the page's own group. */
    groupKeys: readonly string[];
    /** Adapter-validated hand detail (WoW: roles + character). */
    handDetail?: Record<string, unknown>;
    /** False while a required field (e.g. roles) is missing — the join waits. */
    ready: boolean;
}

/** Extra fields the plugin adds to a lock-in (an "Any" group picks its instance). */
export interface LfgLockInExtra {
    /**
     * `CreateEventSchema.lfgChosenGroupKey` — the instance picked when locking
     * in the Any-dungeon (`''`) group. Absent = no instance (generic roster).
     */
    lfgChosenGroupKey?: string;
}

export interface LfgRaiseHandFieldsProps {
    context: LfgGroupingContext;
    onChange: (selection: LfgRaiseHandSelection) => void;
}

export interface LfgGroupSectionsProps {
    context: LfgGroupingContext;
    /** `GET /lfg/:gameId/groups?include=catalogue`, fetched by core. */
    groups: readonly LfgGroupListItemDto[];
    isLoading: boolean;
}

export interface LfgMemberBadgesProps {
    context: LfgGroupingContext;
    member: LfgMemberDto;
}

export interface LfgLockInFieldsProps {
    context: LfgGroupingContext;
    group: LfgGroupDetailDto;
    onChange: (extra: LfgLockInExtra) => void;
}

/** One plugin's grouping for a set of games. Every component is optional. */
export interface LfgGrouping {
    /** The manifest behaviour id (kind `lfg-grouping`) this implements. */
    id: string;
    /** Game slugs this grouping applies to. */
    gameSlugs: readonly string[];
    /** LFG page header (the hub picker). */
    HeaderControls?: ComponentType<LfgGroupingContext>;
    /** The group list on the whole-game page (dungeon / raid sections). */
    GroupSections?: ComponentType<LfgGroupSectionsProps>;
    /** Fields shown after the urgency pick, before the hand is raised. */
    RaiseHandFields?: ComponentType<LfgRaiseHandFieldsProps>;
    /** Per-member badges (role, character) on the group page. */
    MemberBadges?: ComponentType<LfgMemberBadgesProps>;
    /** Extra fields inside the lock-in confirm. */
    LockInFields?: ComponentType<LfgLockInFieldsProps>;
}

/** A grouping and the plugin that owns it. */
export interface LfgGroupingRegistration {
    pluginSlug: string;
    grouping: LfgGrouping;
}

/** Keyed `pluginSlug:id` — re-registering replaces (HMR). */
const groupings = new Map<string, LfgGroupingRegistration>();

/** @internal Called by `PluginHandle.registerLfgGrouping`. */
export function addLfgGrouping(pluginSlug: string, grouping: LfgGrouping): void {
    groupings.set(`${pluginSlug}:${grouping.id}`, { pluginSlug, grouping });
}

/** @internal Called by `clearRegistry`. */
export function clearLfgGroupings(): void {
    groupings.clear();
}

/** Every registration, regardless of plugin status — callers filter by active plugin. */
export function getLfgGroupingRegistrations(): readonly LfgGroupingRegistration[] {
    return [...groupings.values()];
}

/**
 * The active grouping for a game slug, or null. Pure so it is testable without
 * a store; {@link useLfgGrouping} is the component-facing form.
 */
export function resolveLfgGrouping(
    gameSlug: string | undefined,
    activeSlugs: ReadonlySet<string>,
): LfgGrouping | null {
    if (!gameSlug) return null;
    const hit = getLfgGroupingRegistrations().find(
        (r) => activeSlugs.has(r.pluginSlug) && r.grouping.gameSlugs.includes(gameSlug),
    );
    return hit?.grouping ?? null;
}

/** The active plugin's grouping for `gameSlug`; null = today's single-group page. */
export function useLfgGrouping(gameSlug: string | undefined): LfgGrouping | null {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    return resolveLfgGrouping(gameSlug, activeSlugs);
}
