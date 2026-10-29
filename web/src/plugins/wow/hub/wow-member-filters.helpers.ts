/**
 * ROK-1173 — the WoW Members filters (AC2) as pure functions: the state, the
 * options derived from the roster, the predicate (AND across groups, OR
 * within one), the active-group count for the funnel/FAB badge and the extra
 * "Sort by" options. Professions come from roster insights, joined by
 * `characterId` (spec D2) — unlinked rows never carry any.
 */
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type { HubMemberRow, HubMemberSort } from '../../hub-module';
import { MEMBER_SORT_PRESETS } from '../../../components/hub/hub-members.helpers';
import { rankLabel } from './wow-guild.helpers';

export type WowRosterProfession = NonNullable<WowRosterInsightsDto['professions']>[number];

/** `effectiveRole`, or `unknown` for unlinked rows and rows with no role set (spec Q3: no guessing). */
export type WowRoleOption = 'tank' | 'healer' | 'dps' | 'unknown';

export const WOW_ROLE_OPTIONS: readonly { value: WowRoleOption; label: string }[] = [
    { value: 'tank', label: 'Tank' },
    { value: 'healer', label: 'Healer' },
    { value: 'dps', label: 'DPS' },
    { value: 'unknown', label: 'Unknown' },
];

export const PROFESSION_FILTER_LABEL = 'Profession (linked characters with synced professions only)';

export interface WowMemberFilterState {
    classes: readonly string[];
    roles: readonly WowRoleOption[];
    /** Rank keys (`String(rankIndex ?? 'none')`, the same key the rank bands use). */
    ranks: readonly string[];
    levelMin: number | null;
    levelMax: number | null;
    linkedOnly: boolean;
    professions: readonly string[];
}

export const EMPTY_WOW_MEMBER_FILTERS: WowMemberFilterState = {
    classes: [], roles: [], ranks: [], levelMin: null, levelMax: null, linkedOnly: false, professions: [],
};

export interface WowRankOption { key: string; label: string }

export interface WowMemberFilterOptions {
    /** Classes present in the roster, A–Z. */
    classes: readonly string[];
    /** Ranks present in the roster, in roster (rank) order. */
    ranks: readonly WowRankOption[];
    /** Highest level in the roster; null when no row reports one. */
    maxLevel: number | null;
}

/** characterId → the professions that character has synced. */
export type ProfessionIndex = ReadonlyMap<string, ReadonlySet<string>>;

export function wowRankKey(row: Pick<HubMemberRow, 'rankIndex'>): string {
    return String(row.rankIndex ?? 'none');
}

export function wowRoleOf(row: Pick<HubMemberRow, 'effectiveRole'>): WowRoleOption {
    return row.effectiveRole ?? 'unknown';
}

/** Filter options from every listed row (classes, ranks, the level cap for the clamp). */
export function wowFilterOptions(rows: readonly HubMemberRow[]): WowMemberFilterOptions {
    const classes = new Set<string>();
    const ranks = new Map<string, string>();
    let maxLevel: number | null = null;
    for (const row of rows) {
        if (row.class) classes.add(row.class);
        const key = wowRankKey(row);
        if (!ranks.has(key)) ranks.set(key, rankLabel(row));
        if (row.level !== null && (maxLevel === null || row.level > maxLevel)) maxLevel = row.level;
    }
    return {
        classes: [...classes].sort((a, b) => a.localeCompare(b)),
        ranks: [...ranks].map(([key, label]) => ({ key, label })),
        maxLevel,
    };
}

/** Clamp a typed level into 1..maxLevel (just ≥ 1 when the roster reports no level). Null stays null. */
export function clampLevel(value: number | null, maxLevel: number | null): number | null {
    if (value === null || Number.isNaN(value)) return null;
    const whole = Math.round(value);
    const floor = Math.max(1, whole);
    return maxLevel === null ? floor : Math.min(floor, Math.max(1, maxLevel));
}

/** The insights professions as a lookup by character. */
export function buildProfessionIndex(professions: readonly WowRosterProfession[] | undefined): ProfessionIndex {
    const index = new Map<string, Set<string>>();
    for (const profession of professions ?? []) {
        for (const member of profession.members) {
            const set = index.get(member.characterId) ?? new Set<string>();
            set.add(profession.name);
            index.set(member.characterId, set);
        }
    }
    return index;
}

/** One group: empty = no constraint; otherwise the row's value must be one of them. */
function anyOf<T>(selected: readonly T[], value: T): boolean {
    return selected.length === 0 || selected.includes(value);
}

function inLevelRange(state: WowMemberFilterState, level: number | null): boolean {
    if (state.levelMin === null && state.levelMax === null) return true;
    if (level === null) return false;
    return (state.levelMin === null || level >= state.levelMin) && (state.levelMax === null || level <= state.levelMax);
}

function hasProfession(state: WowMemberFilterState, row: HubMemberRow, index: ProfessionIndex): boolean {
    if (state.professions.length === 0) return true;
    const own = row.characterId === null ? undefined : index.get(row.characterId);
    return own !== undefined && state.professions.some((name) => own.has(name));
}

/** True when the row passes every active group (AND across groups, OR within one). */
export function wowMemberMatches(state: WowMemberFilterState, row: HubMemberRow, index: ProfessionIndex): boolean {
    return (
        (row.class !== null ? anyOf(state.classes, row.class) : state.classes.length === 0) &&
        anyOf(state.roles, wowRoleOf(row)) &&
        anyOf(state.ranks, wowRankKey(row)) &&
        inLevelRange(state, row.level) &&
        (!state.linkedOnly || row.characterId !== null) &&
        hasProfession(state, row, index)
    );
}

/** Active filter GROUPS (the badge): level min/max together count as one. */
export function countActiveWowFilters(state: WowMemberFilterState): number {
    return [
        state.classes.length > 0,
        state.roles.length > 0,
        state.ranks.length > 0,
        state.levelMin !== null || state.levelMax !== null,
        state.linkedOnly,
        state.professions.length > 0,
    ].filter(Boolean).length;
}

/** Add the value when absent, drop it when present (order kept). */
export function toggleValue<T>(selected: readonly T[], value: T): readonly T[] {
    return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

export interface ProfessionCoverage { name: string; count: number }

/** Professions with at least one member, most members first, then A–Z. */
export function professionCoverage(professions: readonly WowRosterProfession[]): readonly ProfessionCoverage[] {
    return professions
        .map((p) => ({ name: p.name, count: new Set(p.members.map((m) => m.characterId)).size }))
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** AC4: the WoW "Sort by" options after core's Rank / Name A–Z / Name Z–A. */
export const WOW_MEMBER_SORTS: readonly HubMemberSort[] = [
    MEMBER_SORT_PRESETS.levelDesc,
    MEMBER_SORT_PRESETS.levelAsc,
    MEMBER_SORT_PRESETS.lastSeen,
];
