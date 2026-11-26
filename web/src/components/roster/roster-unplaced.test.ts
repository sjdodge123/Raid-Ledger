import { describe, it, expect } from 'vitest';
import type { RosterRole } from '@raid-ledger/contract';
import { findUnplacedAssignments } from './roster-unplaced';
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

    it('never lists a bench assignment, since the bench grows to fit', () => {
        expect(findUnplacedAssignments([placed(5, 'bench', 9)], visible, getSlotCount)).toEqual([]);
    });
});
