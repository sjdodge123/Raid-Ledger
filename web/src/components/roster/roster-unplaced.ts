import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';

/**
 * ROK-2348: assignments the slot grid cannot show.
 *
 * `RoleSlotGrid` renders an assignment only when its `slot` is one of the
 * visible role groups and, outside the bench (which grows to fit), its
 * `position` is within that role's slot count. An assignment with no role, a
 * role the event's slot setup no longer has (an MMO `dps` row on a generic
 * event, a `flex` row nothing renders) or a position past the count was
 * invisible — and the Unassigned bar, which counted only the pool, then read
 * "All players assigned" over an empty grid. These rows belong in that bar.
 */
export function findUnplacedAssignments(
    assignments: RosterAssignmentResponse[],
    visibleRoles: RosterRole[],
    getSlotCount: (role: RosterRole) => number,
): RosterAssignmentResponse[] {
    const visible = new Set<RosterRole>(visibleRoles);
    return assignments.filter((a) => {
        if (a.slot === null || !visible.has(a.slot)) return true;
        if (a.slot === 'bench') return false;
        return a.position < 1 || a.position > getSlotCount(a.slot);
    });
}
