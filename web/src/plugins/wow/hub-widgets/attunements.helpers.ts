/**
 * ROK-1927 (W13) — pure helpers for the WoW: Forever "Attunements" Overview
 * card: faction variants (Onyxia, Molten Core) merge into one row per
 * `groupKey`, untracked definitions are greyed and never counted (AC8), and
 * the card's freshness is the oldest contributing member's capture (D8).
 */
import type { HubFactFreshness, WowRosterAttunementDto, WowRosterAttunementsDto } from '@raid-ledger/contract';

/** One card row: an attunement group's tally over the whole roster. */
export interface AttunementGroupRow {
    groupKey: string;
    instance: string;
    /** False when no definition in the group is trackable yet. */
    trackable: boolean;
    untrackedReason: string | null;
    done: number;
    inProgress: number;
    notStarted: number;
    noData: number;
    /** Every roster member the group covers (done + in progress + not started + no data). */
    total: number;
}

/** §4.5 sentence when no attunement has Blizzard-confirmed ids yet. */
export const ATTUNEMENTS_UNVERIFIED_COPY = "Attunement data for Forever isn't verified yet.";
/** §7 sentence when no roster member has shared quest data. */
export const ATTUNEMENTS_NO_DATA_COPY = 'Nobody has shared quest data yet — import LedgerLink or link your Armory.';

function emptyRow(def: WowRosterAttunementDto): AttunementGroupRow {
    return {
        groupKey: def.groupKey, instance: def.instance, trackable: false,
        untrackedReason: def.untrackedReason, done: 0, inProgress: 0, notStarted: 0, noData: 0, total: 0,
    };
}

function addCounts(row: AttunementGroupRow, def: WowRosterAttunementDto): void {
    const { done, inProgress, notStarted, noData } = def.counts;
    row.trackable = true;
    row.untrackedReason = null;
    row.done += done;
    row.inProgress += inProgress;
    row.notStarted += notStarted;
    row.noData += noData;
    row.total += done + inProgress + notStarted + noData;
}

/** One row per `groupKey`, in first-seen order; only trackable definitions count. */
export function groupAttunements(defs: readonly WowRosterAttunementDto[]): AttunementGroupRow[] {
    const rows = new Map<string, AttunementGroupRow>();
    for (const def of defs) {
        const row = rows.get(def.groupKey) ?? emptyRow(def);
        rows.set(def.groupKey, row);
        if (def.trackable) addCounts(row, def);
    }
    return [...rows.values()];
}

/** True when tracked rows exist and not one member has quest data for any of them. */
export function nobodyHasQuestData(rows: readonly AttunementGroupRow[]): boolean {
    const tracked = rows.filter((r) => r.trackable);
    return tracked.length > 0 && tracked.every((r) => r.done + r.inProgress + r.notStarted === 0);
}

/** Share attuned, 0–100 (an empty roster is 0, never NaN). */
export function attunedPct(row: AttunementGroupRow): number {
    return row.total > 0 ? (row.done / row.total) * 100 : 0;
}

/** The muted line under a row: "6 in progress · 21 without data", or null. */
export function rowNote(row: AttunementGroupRow, hideNoData: boolean): string | null {
    const parts: string[] = [];
    if (row.inProgress > 0) parts.push(`${row.inProgress} in progress`);
    if (row.noData > 0 && !hideNoData) parts.push(`${row.noData} without data`);
    return parts.length > 0 ? parts.join(' · ') : null;
}

/** "Not tracked yet — needs reputation data" (the reason is the server's). */
export function untrackedCopy(row: AttunementGroupRow): string {
    return row.untrackedReason === null ? 'Not tracked yet' : `Not tracked yet — ${row.untrackedReason}`;
}

/** The footer freshness: the oldest member capture and that member's source. */
export function attunementsFreshness(dto: WowRosterAttunementsDto): HubFactFreshness | null {
    const oldest = dto.oldestAsOf;
    const withSource = dto.members.filter((m) => m.source !== null);
    const owner = withSource.find((m) => m.asOf === oldest) ?? withSource[0];
    if (owner === undefined || owner.source === null) return null;
    return { source: owner.source, asOf: oldest };
}
