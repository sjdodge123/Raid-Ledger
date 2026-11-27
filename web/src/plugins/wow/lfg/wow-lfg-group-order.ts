/**
 * ROK-2352 §4.1 — the WoW group list order: the "Any dungeon" (`''`) group
 * first, then dungeons and raids in their own sections, each Full groups
 * first, then by size (live hands), then by label.
 */
import type { LfgGroupListItemDto } from '@raid-ledger/contract';

/** The list split the way the WoW LFG page renders it. */
export interface WowLfgGroupSections {
    any: LfgGroupListItemDto | null;
    dungeons: LfgGroupListItemDto[];
    raids: LfgGroupListItemDto[];
}

/** True when distinct live members cover every role of the roster shape. */
export function isFullGroup(group: LfgGroupListItemDto): boolean {
    const { rosterShape: shape, coverage } = group;
    if (!shape || !coverage) return false;
    return coverage.tank >= shape.tank && coverage.healer >= shape.healer && coverage.dps >= shape.dps;
}

function compareGroups(a: LfgGroupListItemDto, b: LfgGroupListItemDto): number {
    const full = Number(isFullGroup(b)) - Number(isFullGroup(a));
    if (full !== 0) return full;
    if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
    return (a.groupLabel ?? '').localeCompare(b.groupLabel ?? '');
}

/** Split and order `GET /lfg/:gameId/groups` for the WoW group list. */
export function orderWowLfgGroups(groups: readonly LfgGroupListItemDto[]): WowLfgGroupSections {
    const isAny = (g: LfgGroupListItemDto): boolean => (g.groupKey ?? '') === '';
    return {
        any: groups.find(isAny) ?? null,
        dungeons: groups.filter((g) => !isAny(g) && g.kind !== 'raid').sort(compareGroups),
        raids: groups.filter((g) => !isAny(g) && g.kind === 'raid').sort(compareGroups),
    };
}
