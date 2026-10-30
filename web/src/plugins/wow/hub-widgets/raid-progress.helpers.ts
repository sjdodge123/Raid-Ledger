/**
 * ROK-1917 (W10) — pure copy helpers for the "Raid progress" card: the row cap
 * before the "N more bosses" disclosure (spec Q3), the headline counts, the
 * "First kill Nov 6" line and when a row needs its difficulty label.
 */
import type { WowRosterRaidProgressBossDto } from '@raid-ledger/contract';

/** Boss rows shown before the "N more bosses" disclosure (spec Q3). */
export const RAID_PROGRESS_ROWS = 8;

/** AC7 copy, verbatim. */
export const RAID_PROGRESS_EMPTY_COPY = "No raid pulls yet — a raider's LedgerLink raid export fills this card.";

/** "1 kill" / "3 kills", "1 wipe" / "0 wipes". */
export function plural(n: number, word: string): string {
    return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** "boss killed" / "bosses killed" — the headline's label beside the big number. */
export function killedLabel(killed: number): string {
    return killed === 1 ? 'boss killed' : 'bosses killed';
}

/** "from 41 pulls in LedgerLink raid exports". */
export function pullsLine(pulls: number): string {
    return `from ${plural(pulls, 'pull')} in LedgerLink raid exports`;
}

/** "First kill Nov 6", or "Not killed yet" for a boss with wipes only. */
export function firstKillLine(firstKillAt: string | null): string {
    if (firstKillAt === null) return 'Not killed yet';
    const day = new Date(firstKillAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `First kill ${day}`;
}

/**
 * Encounters that appear at two or more difficulties: only their rows carry
 * the difficulty label (AC6), so a single-difficulty raid stays uncluttered.
 */
export function multiDifficultyEncounters(bosses: readonly WowRosterRaidProgressBossDto[]): ReadonlySet<number> {
    const seen = new Map<number, number>();
    for (const b of bosses) seen.set(b.encounterId, (seen.get(b.encounterId) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
}

/** The label a row shows: null when unmapped or when the encounter has one difficulty. */
export function rowDifficulty(boss: WowRosterRaidProgressBossDto, multi: ReadonlySet<number>): string | null {
    return multi.has(boss.encounterId) ? boss.difficultyLabel : null;
}
