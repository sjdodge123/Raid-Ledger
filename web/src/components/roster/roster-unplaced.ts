import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';

/**
 * ROK-2348: how many bench positions the slot grid renders.
 *
 * Server bench positions are `max(position) + 1` and never compacted, so after
 * promotions a bench row can sit at position 3 with nothing at 1 or 2. The grid
 * renders positions 1..count; this count reaches past the highest occupied
 * position (plus one open seat), so every bench row with a position of 1 or
 * more is visible.
 */
export function benchSlotCount(configured: number, bench: RosterAssignmentResponse[]): number {
    const maxPosition = bench.reduce((max, a) => Math.max(max, a.position), 0);
    return Math.max(configured, bench.length + 1, maxPosition + 1);
}

/**
 * ROK-2348: assignments the slot grid cannot show.
 *
 * `RoleSlotGrid` renders an assignment only when its `slot` is one of the
 * visible role groups and its `position` is one the group renders: 1..the
 * role's slot count, or for the bench 1..`benchSlotCount` (always ≥ every bench
 * position). An assignment with no role, a role the event's slot setup no
 * longer has (an MMO `dps` row on a generic event, a `flex` row nothing
 * renders) or a position outside that range was invisible — and the
 * Unassigned bar, which counted only the pool, then read "All players
 * assigned" over an empty grid. These rows belong in that bar.
 */
export function findUnplacedAssignments(
    assignments: RosterAssignmentResponse[],
    visibleRoles: RosterRole[],
    getSlotCount: (role: RosterRole) => number,
): RosterAssignmentResponse[] {
    const visible = new Set<RosterRole>(visibleRoles);
    return assignments.filter((a) => {
        if (a.slot === null || !visible.has(a.slot)) return true;
        if (a.position < 1) return true;
        return a.slot !== 'bench' && a.position > getSlotCount(a.slot);
    });
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
    visibleRoles: RosterRole[],
    getSlotCount: (role: RosterRole) => number,
): { pool: RosterAssignmentResponse[]; assignments: RosterAssignmentResponse[] } {
    const unplaced = findUnplacedAssignments(assignments, visibleRoles, getSlotCount);
    if (unplaced.length === 0) return { pool, assignments };
    const ids = new Set(unplaced.map((a) => a.signupId));
    return {
        pool: [...pool, ...unplaced.map((a) => ({ ...a, slot: null, position: 0 }))],
        assignments: assignments.filter((a) => !ids.has(a.signupId)),
    };
}
