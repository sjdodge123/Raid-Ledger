/**
 * ROK-2128 — pure helpers for Add character → "Guild roster" (the pick list
 * of a guild's unclaimed, already-imported roster rows).
 */
import {
    WOW_FOREVER_SELECTABLE_RULESETS,
    type CharacterDto,
    type RosterClaimCandidateDto,
    type RosterClaimGuildDto,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';

/** Rows whose name contains the query (case-insensitive); guilds left empty are dropped. */
export function filterRosterGuilds(guilds: readonly RosterClaimGuildDto[], query: string): RosterClaimGuildDto[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...guilds];
    return guilds
        .map((g) => ({ ...g, candidates: g.candidates.filter((c) => c.name.toLowerCase().includes(q)) }))
        .filter((g) => g.candidates.length > 0);
}

/** Total candidates across every guild. */
export function countCandidates(guilds: readonly RosterClaimGuildDto[]): number {
    return guilds.reduce((n, g) => n + g.candidates.length, 0);
}

/** "Lv 60 · Mage"; either half is dropped when the roster row lacks it. */
export function rosterMetaLine(c: Pick<RosterClaimCandidateDto, 'level' | 'class'>): string {
    return [c.level === null ? null : `Lv ${c.level}`, c.class].filter((p): p is string => !!p).join(' · ');
}

function isSelectable(r: string | null | undefined): r is WowForeverSelectableRuleset {
    return !!r && (WOW_FOREVER_SELECTABLE_RULESETS as readonly string[]).includes(r);
}

/** FLAG 4: the ruleset of the user's existing Forever character, else `normal`. */
export function defaultClaimRuleset(existing: readonly CharacterDto[]): WowForeverSelectableRuleset {
    const found = existing.find((c) => isSelectable(c.ruleset));
    return isSelectable(found?.ruleset) ? found.ruleset : 'normal';
}

/** FLAG 9: "Guild roster" opens by default only for a user with no character of the game and a non-empty list. */
export function shouldDefaultToRoster(existing: readonly CharacterDto[], candidateCount: number): boolean {
    return existing.length === 0 && candidateCount > 0;
}

/** Removes one claimed/lost row from a cached list response. */
export function withoutMember(guilds: readonly RosterClaimGuildDto[], memberId: number): RosterClaimGuildDto[] {
    return guilds
        .map((g) => ({ ...g, candidates: g.candidates.filter((c) => c.memberId !== memberId) }))
        .filter((g) => g.candidates.length > 0);
}
