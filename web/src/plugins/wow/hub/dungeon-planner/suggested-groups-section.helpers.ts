/**
 * ROK-2212 — the planner tab's "Suggested groups" list: the dungeons it can be
 * filtered to (only those with a group, in the API's ranked order) and the
 * groups shown, never more than 10 per dungeon (ruling 7; the API caps too).
 */
import { MAX_SUGGESTED_GROUPS_PER_DUNGEON, type SuggestedGroupDto } from '@raid-ledger/contract';

export interface DungeonOption {
    id: number;
    name: string;
}

/** Distinct dungeons in first-seen order. */
export function dungeonOptions(groups: readonly SuggestedGroupDto[]): DungeonOption[] {
    const seen = new Map<number, DungeonOption>();
    for (const g of groups) if (!seen.has(g.instance.id)) seen.set(g.instance.id, { id: g.instance.id, name: g.instance.name });
    return [...seen.values()];
}

/** The groups for `instanceId` (null = every dungeon), at most 10 per dungeon, API order kept. */
export function visibleGroups(groups: readonly SuggestedGroupDto[], instanceId: number | null): SuggestedGroupDto[] {
    const perDungeon = new Map<number, number>();
    return groups.filter((g) => {
        if (instanceId !== null && g.instance.id !== instanceId) return false;
        const n = perDungeon.get(g.instance.id) ?? 0;
        perDungeon.set(g.instance.id, n + 1);
        return n < MAX_SUGGESTED_GROUPS_PER_DUNGEON;
    });
}

/** A stable React key for a group (several per dungeon). */
export function groupKey(g: SuggestedGroupDto): string {
    return `${g.instance.id}:${g.members.map((m) => m.key).join(',')}`;
}
