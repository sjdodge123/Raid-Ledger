/**
 * ROK-1790 — pure helpers behind the WoW: Forever Crafters tab (the guild
 * crafters directory). It reads the same `roster-insights.professions`
 * payload as the Guild professions widget and the Members-tab coverage strip,
 * so the three never disagree (spec D1). Filters per operator ruling
 * 2026-11-12 Q3: search + Profession + minimum skill.
 */
import type { GuildPage, WowRosterInsightsDto } from '@raid-ledger/contract';
import { sortMembers, type RosterProfession } from '../../hub-widgets/professions.helpers';

/** The Crafters filter state. Empty `professions` / null `minSkill` = that group is off. */
export interface CrafterFilters {
    professions: readonly string[];
    minSkill: number | null;
}

export const EMPTY_CRAFTER_FILTERS: CrafterFilters = { professions: [], minSkill: null };

export interface MinSkillOption {
    label: string;
    value: number | null;
}

/** The minimum-skill choices from the approved mockup. */
export const MIN_SKILL_OPTIONS: readonly MinSkillOption[] = [
    { label: 'Any', value: null },
    { label: '150+', value: 150 },
    { label: '225+', value: 225 },
    { label: '300', value: 300 },
];

/**
 * The professions left after search + filters, each with its members sorted
 * by skill (highest first). Groups combine with AND, values within a group
 * with OR. A query matching a profession name keeps all of its crafters; one
 * matching a character name narrows each card to those crafters. A minimum
 * skill drops unknown skills. Professions left with no members are dropped.
 */
export function filterCrafters(
    professions: readonly RosterProfession[], query: string, filters: CrafterFilters,
): RosterProfession[] {
    const q = query.trim().toLowerCase();
    const out: RosterProfession[] = [];
    for (const p of professions) {
        if (filters.professions.length > 0 && !filters.professions.includes(p.name)) continue;
        let members = p.members.filter((m) => meetsMinSkill(m.skill, filters.minSkill));
        if (q !== '' && !p.name.toLowerCase().includes(q)) {
            members = members.filter((m) => m.name.toLowerCase().includes(q));
        }
        if (members.length > 0) out.push({ name: p.name, members: sortMembers(members) });
    }
    return out;
}

function meetsMinSkill(skill: number | null, min: number | null): boolean {
    if (min === null) return true;
    return skill !== null && skill >= min;
}

/** How many filter groups are on — the funnel / FAB badge count. */
export function activeCount(filters: CrafterFilters): number {
    return (filters.professions.length > 0 ? 1 : 0) + (filters.minSkill !== null ? 1 : 0);
}

/** Profession names for the Profession filter chips, A–Z. */
export function professionOptions(professions: readonly RosterProfession[]): string[] {
    return professions.map((p) => p.name).sort((a, b) => a.localeCompare(b));
}

/**
 * Whether the viewer gets the Crafters tab: members and staff only (the API
 * omits `professions` for visitors), and only while the guild has profession
 * data. An unloaded payload (`insights` undefined) counts as "maybe", so a
 * `#crafters` deep link resolves before the query lands.
 */
export function canSeeCrafters(
    viewer: Pick<GuildPage['viewer'], 'role' | 'isStaff'>,
    insights: Pick<WowRosterInsightsDto, 'professions'> | undefined,
): boolean {
    if (viewer.role === 'visitor' && viewer.isStaff !== true) return false;
    if (insights === undefined) return true;
    return (insights.professions?.length ?? 0) > 0;
}
