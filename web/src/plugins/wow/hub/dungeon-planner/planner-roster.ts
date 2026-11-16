/**
 * ROK-2216 — the Dungeon planner's picker options, read from the hub's shared
 * roster-insights payload (spec L2), and the link tokens resolved against them
 * (spec L1: a token not on the current roster is dropped from the view).
 */
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import { tokenKey, type PlanToken } from './planner-url';

type RosterMember = WowRosterInsightsDto['classes'][number]['members'][number];

/** One pickable roster character. */
export interface RosterPick {
    /** The link token's text — uuid (claimed) or `m<memberId>` (unclaimed); unique per pick. */
    key: string;
    token: PlanToken;
    name: string;
    className: string;
    level: number | null;
    /** True when the row has a claimed character (quest data, invitable). */
    claimed: boolean;
}

/** A roster row as a pick; null when it has neither a character id nor a member id. */
function toPick(member: RosterMember, className: string): RosterPick | null {
    const base = { name: member.name, className, level: member.level };
    if (member.characterId !== null) {
        const token: PlanToken = { kind: 'character', characterId: member.characterId.toLowerCase() };
        return { ...base, key: tokenKey(token), token, claimed: true };
    }
    if (member.memberId === undefined) return null;
    const token: PlanToken = { kind: 'member', memberId: member.memberId };
    return { ...base, key: tokenKey(token), token, claimed: false };
}

/** Every pickable roster row in roster order (one per key); [] before the roster loads. */
export function rosterPicks(roster: Pick<WowRosterInsightsDto, 'classes'> | undefined): RosterPick[] {
    const byKey = new Map<string, RosterPick>();
    for (const row of roster?.classes ?? []) {
        for (const member of row.members) {
            const pick = toPick(member, row.class);
            if (pick && !byKey.has(pick.key)) byKey.set(pick.key, pick);
        }
    }
    return [...byKey.values()];
}

/** The link's tokens as roster picks, in link order; tokens not on the roster are dropped. */
export function resolvePicks(tokens: PlanToken[], options: RosterPick[]): RosterPick[] {
    const byKey = new Map(options.map((o) => [o.key, o]));
    return tokens.flatMap((t) => byKey.get(tokenKey(t)) ?? []);
}
