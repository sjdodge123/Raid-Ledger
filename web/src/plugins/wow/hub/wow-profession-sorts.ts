/**
 * ROK-2281 — the per-profession "Sort by" options on the WoW Members list.
 * Picking a profession pill (the Profession filter) adds `<Profession>
 * high→low` and `<Profession> low→high` for each picked profession, in pick
 * order; no pick, no extra options. A member with no skill number for that
 * profession sorts last in BOTH directions (operator ruling 4). Core breaks
 * ties by name and drops back to its default sort when the active option
 * leaves the list (an unpicked pill — ruling 3).
 */
import type { HubMemberRow, HubMemberSort } from '../../hub-module';
import { professionMemberKey, rowProfessionKey } from '../lib/profession-member-key';
import type { WowRosterProfession } from './wow-member-filters.helpers';

/** Row key → profession name → reported skill (an unreported skill has no entry). */
export type ProfessionSkillIndex = ReadonlyMap<string, ReadonlyMap<string, number>>;

export type ProfessionSortDirection = 'desc' | 'asc';

/** The insights professions as a skill lookup by row key (the highest skill when a member is listed twice). */
export function buildProfessionSkillIndex(professions: readonly WowRosterProfession[] | undefined): ProfessionSkillIndex {
    const index = new Map<string, Map<string, number>>();
    for (const profession of professions ?? []) {
        for (const member of profession.members) {
            const key = professionMemberKey(member);
            if (key === null || member.skill === null) continue;
            const skills = index.get(key) ?? new Map<string, number>();
            skills.set(profession.name, Math.max(member.skill, skills.get(profession.name) ?? 0));
            index.set(key, skills);
        }
    }
    return index;
}

/** One row's skill in a profession; undefined when it has none reported. */
function skillOf(index: ProfessionSkillIndex, row: HubMemberRow, name: string): number | undefined {
    return index.get(rowProfessionKey(row))?.get(name);
}

/** Orders by the profession's skill; a row without one goes last whichever way (0 = tie, core sorts ties by name). */
export function professionSkillCompare(
    index: ProfessionSkillIndex, name: string, direction: ProfessionSortDirection,
): (a: HubMemberRow, b: HubMemberRow) => number {
    return (a, b) => {
        const sa = skillOf(index, a, name);
        const sb = skillOf(index, b, name);
        if (sa === undefined) return sb === undefined ? 0 : 1;
        if (sb === undefined) return -1;
        return direction === 'desc' ? sb - sa : sa - sb;
    };
}

/** A stable option id per profession + direction (`profession-mining-desc`). */
export function professionSortId(name: string, direction: ProfessionSortDirection): string {
    return `profession-${name.toLowerCase().replace(/\s+/g, '-')}-${direction}`;
}

/** The pair of options for each picked profession, in pick order; none when nothing is picked. */
export function professionSorts(selected: readonly string[], index: ProfessionSkillIndex): readonly HubMemberSort[] {
    return selected.flatMap((name) => [
        { id: professionSortId(name, 'desc'), label: `${name} high→low`, compare: professionSkillCompare(index, name, 'desc') },
        { id: professionSortId(name, 'asc'), label: `${name} low→high`, compare: professionSkillCompare(index, name, 'asc') },
    ]);
}
