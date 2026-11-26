import { describe, it, expect } from 'vitest';
import type { RosterRole } from '@raid-ledger/contract';
import { BENCH_SEAT_HEADROOM, benchSlotCount, findUnplacedAssignments, splitUnplaced, unplacedMovedNote } from './roster-unplaced';
import { makePlayer } from './RosterBuilder.test-helpers';

const counts: Partial<Record<RosterRole, number>> = { player: 2, bench: 0, flex: 0 };
const getSlotCount = (role: RosterRole): number => counts[role] ?? 0;

function placed(id: number, role: RosterRole | null, position: number) {
    return { ...makePlayer(id, role, `P${id}`), slot: role, position };
}

describe('findUnplacedAssignments (ROK-2348)', () => {
    it('keeps an assignment inside a visible slot out of the list', () => {
        expect(findUnplacedAssignments([placed(1, 'player', 1)], getSlotCount, 1)).toEqual([]);
    });

    it('lists an assignment whose role the slot setup does not render', () => {
        const dps = placed(2, 'dps', 1);
        expect(findUnplacedAssignments([dps], getSlotCount, 1)).toEqual([dps]);
    });

    it('lists an assignment with no role', () => {
        const none = placed(3, null, 0);
        expect(findUnplacedAssignments([none], getSlotCount, 1)).toEqual([none]);
    });

    it('lists an assignment positioned past the role slot count', () => {
        const overflow = placed(4, 'player', 3);
        expect(findUnplacedAssignments([overflow], getSlotCount, 1)).toEqual([overflow]);
    });

    it('keeps a bench row at a gapped position out of the list, because the grid renders it', () => {
        const bench = [placed(5, 'bench', 9)];
        expect(splitUnplaced([], bench, getSlotCount).unplaced).toEqual([]);
        expect(benchSlotCount(0, bench)).toBeGreaterThanOrEqual(9);
    });

    it('lists a bench row with no position, which the grid cannot render', () => {
        const bench = placed(6, 'bench', 0);
        expect(findUnplacedAssignments([bench], getSlotCount, 1)).toEqual([bench]);
    });

    it('keeps a row whose role has slots on the event, even with no role group for it', () => {
        const flexCounts: Partial<Record<RosterRole, number>> = { tank: 2, flex: 2 };
        const flex = placed(7, 'flex', 1);
        expect(findUnplacedAssignments([flex], (r) => flexCounts[r] ?? 0, 1)).toEqual([]);
    });

    it('lists a flex row when the event has no flex slots', () => {
        const flex = placed(8, 'flex', 1);
        expect(findUnplacedAssignments([flex], getSlotCount, 1)).toEqual([flex]);
    });
});

describe('benchSlotCount (ROK-2348)', () => {
    it('renders past the highest bench position after promotions leave a gap', () => {
        expect(benchSlotCount(0, [placed(1, 'bench', 3)])).toBe(4);
    });

    it('keeps one open seat past a packed bench and honours the configured count', () => {
        expect(benchSlotCount(0, [placed(1, 'bench', 1), placed(2, 'bench', 2)])).toBe(3);
        expect(benchSlotCount(6, [placed(1, 'bench', 1)])).toBe(6);
    });

    it('caps a stray bench position at the row count plus the headroom', () => {
        const bench = [placed(1, 'bench', 1), placed(2, 'bench', 100000)];
        expect(benchSlotCount(0, bench)).toBe(bench.length + BENCH_SEAT_HEADROOM + 1);
    });

    it('moves a bench row past the cap to the pool and keeps the rows under it', () => {
        const low = placed(1, 'bench', 2);
        const stray = placed(2, 'bench', 100000);
        const result = splitUnplaced([], [low, stray], getSlotCount);
        expect(result.assignments).toEqual([low]);
        expect(result.unplaced).toEqual([stray]);
        expect(result.benchCount).toBe(3);
    });
});

describe('splitUnplaced (ROK-2348)', () => {
    it('moves unplaced rows to the pool as unassigned and drops them from the assignments', () => {
        const kept = placed(1, 'player', 1);
        const orphan = placed(2, 'dps', 1);
        const pooled = makePlayer(3, null, 'P3');
        const result = splitUnplaced([pooled], [kept, orphan], getSlotCount);
        expect(result.assignments).toEqual([kept]);
        expect(result.pool).toEqual([pooled, { ...orphan, slot: null, position: 0 }]);
        expect(result.unplaced).toEqual([orphan]);
    });

    it('returns the inputs unchanged when every row is placed', () => {
        const pool = [makePlayer(3, null, 'P3')];
        const assignments = [placed(1, 'player', 1)];
        const result = splitUnplaced(pool, assignments, getSlotCount);
        expect(result.pool).toBe(pool);
        expect(result.assignments).toBe(assignments);
    });
});

describe('unplacedMovedNote (ROK-2348)', () => {
    const a = placed(1, 'dps', 1);
    const b = placed(2, null, 0);

    it('counts the unplaced rows the save leaves unassigned', () => {
        expect(unplacedMovedNote([a, b], [])).toBe('. 2 players moved to Unassigned.');
        expect(unplacedMovedNote([a], [])).toBe('. 1 player moved to Unassigned.');
    });

    it('skips a row the save places, and is empty when nothing moves', () => {
        expect(unplacedMovedNote([a, b], [{ ...a, slot: 'player', position: 1 }])).toBe('. 1 player moved to Unassigned.');
        expect(unplacedMovedNote([], [])).toBe('');
    });
});
