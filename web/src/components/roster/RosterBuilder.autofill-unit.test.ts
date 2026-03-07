import { describe, it, expect } from 'vitest';

import { computeAutoFill } from './roster-auto-fill';
import { makePlayer } from './RosterBuilder.test-helpers';
import type { RosterRole } from '@raid-ledger/contract';

function computeautofillUnitGroup1() {
it('MMO: assigns by character role matching', () => {
        const pool = [
            makePlayer(1, 'tank', 'TankA'),
            makePlayer(2, 'healer', 'HealerA'),
            makePlayer(3, 'dps', 'DpsA'),
        ];
        const roleSlots = [
            { role: 'tank' as RosterRole, label: 'Tank' },
            { role: 'healer' as RosterRole, label: 'Healer' },
            { role: 'dps' as RosterRole, label: 'DPS' },
            { role: 'flex' as RosterRole, label: 'Flex' },
        ];
        const getSlotCount = (role: RosterRole) =>
            (({ tank: 2, healer: 4, dps: 14, flex: 5 } as Record<string, number>)[role] ?? 0);

        const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

        expect(result.totalFilled).toBe(3);
        expect(result.newAssignments.find(a => a.username === 'TankA')?.slot).toBe('tank');
        expect(result.newAssignments.find(a => a.username === 'HealerA')?.slot).toBe('healer');
        expect(result.newAssignments.find(a => a.username === 'DpsA')?.slot).toBe('dps');
    });

}

function computeautofillUnitGroup2() {
it('MMO: overflows unmatched players to flex', () => {
        const pool = [makePlayer(1, null, 'NoRole')];
        const roleSlots = [
            { role: 'tank' as RosterRole, label: 'Tank' },
            { role: 'healer' as RosterRole, label: 'Healer' },
            { role: 'dps' as RosterRole, label: 'DPS' },
            { role: 'flex' as RosterRole, label: 'Flex' },
        ];
        const getSlotCount = (role: RosterRole) =>
            (({ tank: 2, healer: 4, dps: 14, flex: 5 } as Record<string, number>)[role] ?? 0);

        const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

        expect(result.totalFilled).toBe(1);
        const assigned = result.newAssignments.find(a => a.username === 'NoRole');
        expect(assigned?.slot).toBe('flex');
        expect(assigned?.isOverride).toBe(true);
    });

}

function computeautofillUnitGroup3() {
it('MMO: backfills empty role slots when flex is full', () => {
        const pool = Array.from({ length: 8 }, (_, i) => makePlayer(i + 1, null, `P${i + 1}`));
        const roleSlots = [
            { role: 'tank' as RosterRole, label: 'Tank' },
            { role: 'healer' as RosterRole, label: 'Healer' },
            { role: 'dps' as RosterRole, label: 'DPS' },
            { role: 'flex' as RosterRole, label: 'Flex' },
        ];
        // Small slots to test backfill: 1 tank, 1 healer, 1 dps, 2 flex = 5 slots
        const getSlotCount = (role: RosterRole) =>
            (({ tank: 1, healer: 1, dps: 1, flex: 2 } as Record<string, number>)[role] ?? 0);

        const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

        expect(result.totalFilled).toBe(5);
        expect(result.newPool.length).toBe(3); // 8 - 5 = 3 remaining
    });

}

function computeautofillUnitGroup4() {
it('MMO: fills bench overflow', () => {
        const pool = Array.from({ length: 3 }, (_, i) => makePlayer(i + 1, null, `P${i + 1}`));
        const roleSlots = [
            { role: 'tank' as RosterRole, label: 'Tank' },
            { role: 'healer' as RosterRole, label: 'Healer' },
            { role: 'dps' as RosterRole, label: 'DPS' },
            { role: 'flex' as RosterRole, label: 'Flex' },
            { role: 'bench' as RosterRole, label: 'Bench' },
        ];
        const getSlotCount = (role: RosterRole) =>
            (({ tank: 0, healer: 0, dps: 0, flex: 0, bench: 3 } as Record<string, number>)[role] ?? 0);

        const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

        expect(result.totalFilled).toBe(3);
        expect(result.newAssignments.every(a => a.slot === 'bench')).toBe(true);
    });

}

function computeautofillUnitGroup5() {
it('Generic: fills player slots sequentially', () => {
        const pool = [
            makePlayer(1, null, 'Alpha'),
            makePlayer(2, null, 'Bravo'),
            makePlayer(3, null, 'Charlie'),
        ];
        const roleSlots = [{ role: 'player' as RosterRole, label: 'Player' }];
        const getSlotCount = (role: RosterRole) => role === 'player' ? 4 : 0;

        const result = computeAutoFill(pool, [], roleSlots, getSlotCount, true);

        expect(result.totalFilled).toBe(3);
        expect(result.newAssignments[0].username).toBe('Alpha');
        expect(result.newAssignments[0].position).toBe(1);
        expect(result.newAssignments[1].username).toBe('Bravo');
        expect(result.newAssignments[1].position).toBe(2);
        expect(result.newAssignments[2].username).toBe('Charlie');
        expect(result.newAssignments[2].position).toBe(3);
    });

}

function computeautofillUnitGroup6() {
it('skips occupied positions', () => {
        const pool = [makePlayer(1, 'tank', 'NewTank')];
        const existing = [{ ...makePlayer(99, 'tank', 'OldTank'), slot: 'tank' as RosterRole, position: 1 }];
        const roleSlots = [
            { role: 'tank' as RosterRole, label: 'Tank' },
            { role: 'healer' as RosterRole, label: 'Healer' },
            { role: 'dps' as RosterRole, label: 'DPS' },
            { role: 'flex' as RosterRole, label: 'Flex' },
        ];
        const getSlotCount = (role: RosterRole) =>
            (({ tank: 2, healer: 4, dps: 14, flex: 5 } as Record<string, number>)[role] ?? 0);

        const result = computeAutoFill(pool, existing, roleSlots, getSlotCount, false);

        expect(result.totalFilled).toBe(1);
        const newTank = result.newAssignments.find(a => a.username === 'NewTank');
        expect(newTank?.slot).toBe('tank');
        expect(newTank?.position).toBe(2); // Position 1 is occupied
    });

}

describe('computeAutoFill (unit)', () => {
    computeautofillUnitGroup1();
    computeautofillUnitGroup2();
    computeautofillUnitGroup3();
    computeautofillUnitGroup4();
    computeautofillUnitGroup5();
    computeautofillUnitGroup6();
});
