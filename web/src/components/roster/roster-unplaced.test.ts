import { describe, it, expect } from 'vitest';
import type { RosterRole } from '@raid-ledger/contract';
import { benchSlotCount, findUnplacedAssignments, splitUnplaced } from './roster-unplaced';
import { makePlayer } from './RosterBuilder.test-helpers';

const counts: Partial<Record<RosterRole, number>> = { player: 2, bench: 0 };
const getSlotCount = (role: RosterRole): number => counts[role] ?? 0;
const visible: RosterRole[] = ['player', 'bench'];

function placed(id: number, role: RosterRole | null, position: number) {
    return { ...makePlayer(id, role, `P${id}`), slot: role, position };
}

describe('findUnplacedAssignments (ROK-2348)', () => {
    it('keeps an assignment inside a visible slot out of the list', () => {
        expect(findUnplacedAssignments([placed(1, 'player', 1)], visible, getSlotCount)).toEqual([]);
    });

    it('lists an assignment whose role the slot setup does not render', () => {
        const dps = placed(2, 'dps', 1);
        expect(findUnplacedAssignments([dps], visible, getSlotCount)).toEqual([dps]);
    });

    it('lists an assignment with no role', () => {
        const none = placed(3, null, 0);
        expect(findUnplacedAssignments([none], visible, getSlotCount)).toEqual([none]);
    });

    it('lists an assignment positioned past the role slot count', () => {
        const overflow = placed(4, 'player', 3);
        expect(findUnplacedAssignments([overflow], visible, getSlotCount)).toEqual([overflow]);
    });

    it('keeps a bench row at a gapped position out of the list, because the grid renders it', () => {
        const bench = [placed(5, 'bench', 9)];
        expect(findUnplacedAssignments(bench, visible, getSlotCount)).toEqual([]);
        expect(benchSlotCount(0, bench)).toBeGreaterThanOrEqual(9);
    });

    it('lists a bench row with no position, which the grid cannot render', () => {
        const bench = placed(6, 'bench', 0);
        expect(findUnplacedAssignments([bench], visible, getSlotCount)).toEqual([bench]);
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
});

describe('splitUnplaced (ROK-2348)', () => {
    it('moves unplaced rows to the pool as unassigned and drops them from the assignments', () => {
        const kept = placed(1, 'player', 1);
        const orphan = placed(2, 'dps', 1);
        const pooled = makePlayer(3, null, 'P3');
        const result = splitUnplaced([pooled], [kept, orphan], visible, getSlotCount);
        expect(result.assignments).toEqual([kept]);
        expect(result.pool).toEqual([pooled, { ...orphan, slot: null, position: 0 }]);
    });

    it('returns the inputs unchanged when every row is placed', () => {
        const pool = [makePlayer(3, null, 'P3')];
        const assignments = [placed(1, 'player', 1)];
        const result = splitUnplaced(pool, assignments, visible, getSlotCount);
        expect(result.pool).toBe(pool);
        expect(result.assignments).toBe(assignments);
    });
});
