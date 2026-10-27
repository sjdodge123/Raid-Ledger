/**
 * ROK-1923 (epic ROK-1905 H8) — pure helpers for the Guild professions widget.
 */
import type { HubFactSource, WowRosterInsightsDto } from '@raid-ledger/contract';

export type RosterProfession = NonNullable<WowRosterInsightsDto['professions']>[number];
export type ProfessionMember = RosterProfession['members'][number];

/** `225/300`, `225`, or null when the skill is unknown. */
export function formatSkill(skill: number | null, maxSkill: number | null): string | null {
    if (skill === null) return null;
    return maxSkill === null ? String(skill) : `${skill}/${maxSkill}`;
}

/** The member with the highest known skill, or undefined when nobody's skill is known. */
export function bestMember(profession: RosterProfession): ProfessionMember | undefined {
    let best: ProfessionMember | undefined;
    for (const m of profession.members) {
        if (m.skill !== null && (best === undefined || m.skill > (best.skill ?? -1))) best = m;
    }
    return best;
}

/** Members sorted by skill, highest first; unknown skills last, then by name. */
export function sortMembers(members: readonly ProfessionMember[]): ProfessionMember[] {
    return [...members].sort((a, b) => (b.skill ?? -1) - (a.skill ?? -1) || a.name.localeCompare(b.name));
}

const SOURCE_LABEL: Record<HubFactSource, string> = { manual: 'manual', addon: 'addon', blizzard: 'Armory', roster: 'roster' };

/** The short per-member source note. */
export function sourceLabel(source: HubFactSource): string {
    return SOURCE_LABEL[source];
}

/** How many distinct characters have at least one profession. */
export function charactersWithProfessions(professions: readonly RosterProfession[]): number {
    return new Set(professions.flatMap((p) => p.members.map((m) => m.characterId))).size;
}

/** `1 character` / `3 characters`. */
export function characterCount(n: number): string {
    return `${n} ${n === 1 ? 'character' : 'characters'}`;
}

/** `1 member` / `3 members`. */
export function memberCount(n: number): string {
    return `${n} ${n === 1 ? 'member' : 'members'}`;
}
