/**
 * ROK-1914 (W6) — pure helpers for the WoW: Forever "Who's saved" widget.
 * The server drops expired lockouts at compute time, but it caches the
 * payload for 5 minutes, so the card filters again against a live clock
 * (D3/AC7): a member whose reset has passed disappears, and a group with no
 * one left disappears with them. The group countdown is the soonest live
 * member reset (Q3).
 */
import type { WowRosterLockoutDto } from '@raid-ledger/contract';

export type RosterLockout = WowRosterLockoutDto;
export type LockoutMember = WowRosterLockoutDto['members'][number];

function isLive(resetAtIso: string, nowMs: number): boolean {
    const at = Date.parse(resetAtIso);
    return !Number.isNaN(at) && at > nowMs;
}

function soonestReset(members: readonly LockoutMember[]): string {
    let soonest = members[0]?.resetAt ?? '';
    for (const m of members) if (Date.parse(m.resetAt) < Date.parse(soonest)) soonest = m.resetAt;
    return soonest;
}

/** The lockouts still in force at `nowMs`; each group's `resetAt` is its soonest live member reset. */
export function liveLockouts(lockouts: readonly RosterLockout[], nowMs: number): RosterLockout[] {
    const live: RosterLockout[] = [];
    for (const group of lockouts) {
        const members = group.members.filter((m) => isLive(m.resetAt, nowMs));
        if (members.length > 0) live.push({ ...group, members, resetAt: soonestReset(members) });
    }
    return live;
}

/** Every member reset instant, for the shared `useNowTick` clock. */
export function lockoutInstants(lockouts: readonly RosterLockout[]): string[] {
    return lockouts.flatMap((g) => g.members.map((m) => m.resetAt));
}

/** True when the member has killed every boss in the instance. */
export function isCleared(killed: number, total: number): boolean {
    return total > 0 && killed >= total;
}

/** "Based on 3 members' addon exports" — the empty-state / footer reporting line (Q5). */
export function reportingLine(addonCount: number): string {
    return addonCount === 1
        ? "Based on 1 member's addon export"
        : `Based on ${addonCount} members' addon exports`;
}
