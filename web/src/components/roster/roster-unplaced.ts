import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';

/** ROK-2348: open bench seats the grid may render past the bench's row count. */
export const BENCH_SEAT_HEADROOM = 25;

/**
 * ROK-2348: how many bench positions the slot grid renders.
 *
 * Server bench positions are `max(position) + 1` and never compacted, so after
 * promotions a bench row can sit at position 3 with nothing at 1 or 2. The grid
 * renders positions 1..count; this count reaches past the highest occupied
 * position (plus one open seat), so a gapped bench row is visible. The reach is
 * capped at `bench.length + BENCH_SEAT_HEADROOM` so a stray position (the
 * contract has no max) cannot render an unbounded grid; rows past the cap are
 * unplaced and land in the Unassigned bar.
 */
export function benchSlotCount(configured: number, bench: RosterAssignmentResponse[]): number {
    const maxPosition = bench.reduce((max, a) => Math.max(max, a.position), 0);
    const cap = bench.length + BENCH_SEAT_HEADROOM;
    return Math.max(configured, bench.length + 1, Math.min(maxPosition, cap) + 1);
}

/**
 * ROK-2348: assignments the slot grid cannot show.
 *
 * A row is unplaced when it has no role, no position, or a position past the
 * slots the event has for its role (for the bench, past `benchCount`). A role
 * the event has no slots for (an MMO `dps` row on a generic event) counts 0.
 * A row whose role HAS slots on the event, inside that range, is never
 * unplaced — even if no role group renders it — because every save sends the
 * unplaced rows as pool and the server then deletes that real row.
 */
export function findUnplacedAssignments(
    assignments: RosterAssignmentResponse[],
    getSlotCount: (role: RosterRole) => number,
    benchCount: number,
): RosterAssignmentResponse[] {
    return assignments.filter((a) => {
        if (a.slot === null || a.position < 1) return true;
        const count = a.slot === 'bench' ? benchCount : getSlotCount(a.slot);
        return a.position > count;
    });
}

export interface RosterSplit {
    pool: RosterAssignmentResponse[];
    assignments: RosterAssignmentResponse[];
    /** The rows moved from the assignments to the pool. */
    unplaced: RosterAssignmentResponse[];
    /** Bench positions the grid renders (`benchSlotCount` over every bench row). */
    benchCount: number;
}

/**
 * ROK-2348: the roster as the builder works with it. Unplaced rows move to the
 * pool (as unassigned, `slot: null`), so the bar, the assignment popup and
 * Auto-Fill all see them, and assigning one replaces its old row instead of
 * adding a second one for the same signup.
 */
export function splitUnplaced(
    pool: RosterAssignmentResponse[],
    assignments: RosterAssignmentResponse[],
    getSlotCount: (role: RosterRole) => number,
): RosterSplit {
    const bench = assignments.filter((a) => a.slot === 'bench' && a.position >= 1);
    const benchCount = benchSlotCount(getSlotCount('bench'), bench);
    const unplaced = findUnplacedAssignments(assignments, getSlotCount, benchCount);
    if (unplaced.length === 0) return { pool, assignments, unplaced, benchCount };
    const ids = new Set(unplaced.map((a) => a.signupId));
    return {
        pool: [...pool, ...unplaced.map((a) => ({ ...a, slot: null, position: 0 }))],
        assignments: assignments.filter((a) => !ids.has(a.signupId)),
        unplaced,
        benchCount,
    };
}

/**
 * ROK-2348: the toast suffix for a save that unassigns unplaced rows. A row
 * the save re-places (it is in `saved`) is not counted.
 */
export function unplacedMovedNote(unplaced: RosterAssignmentResponse[], saved: RosterAssignmentResponse[]): string {
    const savedIds = new Set(saved.map((a) => a.signupId));
    const moved = unplaced.filter((a) => !savedIds.has(a.signupId)).length;
    if (moved === 0) return '';
    return `. ${moved} player${moved === 1 ? '' : 's'} moved to Unassigned.`;
}
