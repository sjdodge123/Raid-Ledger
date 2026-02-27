import { describe, it, expect } from 'vitest';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { computeAutoFill } from './roster-auto-fill';

/** Minimal pool player factory */
function makePoolPlayer(
    overrides: Partial<RosterAssignmentResponse> & { signupId: number },
): RosterAssignmentResponse {
    return {
        id: 0,
        userId: overrides.signupId,
        discordId: `discord-${overrides.signupId}`,
        username: `Player${overrides.signupId}`,
        avatar: null,
        slot: null,
        position: 0,
        isOverride: false,
        character: overrides.character ?? null,
        preferredRoles: null,
        signupStatus: 'signed_up',
        ...overrides,
    };
}

/** Standard MMO role slots */
const mmoRoleSlots: { role: RosterRole; label: string }[] = [
    { role: 'tank', label: 'Tank' },
    { role: 'healer', label: 'Healer' },
    { role: 'dps', label: 'DPS' },
];

/** Default MMO slot counts: 2 tank, 4 healer, 14 dps */
function mmoSlotCount(role: RosterRole): number {
    const counts: Record<string, number> = { tank: 2, healer: 4, dps: 14, flex: 0, bench: 0, player: 0 };
    return counts[role] ?? 0;
}

describe('computeAutoFill', () => {
    describe('ROK-539: flex player role priority (tank/healer before DPS)', () => {
        it('slots player with [dps, healer] prefs into healer when healer slot is open', () => {
            const pool = [
                makePoolPlayer({
                    signupId: 1,
                    preferredRoles: ['dps', 'healer'],
                    character: { id: 'c1', name: 'Char1', className: 'Paladin', role: 'dps', avatarUrl: null },
                }),
            ];

            const result = computeAutoFill(pool, [], mmoRoleSlots, mmoSlotCount, false);

            expect(result.totalFilled).toBe(1);
            const assignment = result.newAssignments[0];
            expect(assignment.slot).toBe('healer');
            expect(assignment.position).toBe(1);
        });

        it('slots player with [dps, healer] prefs into DPS when healer slots are full', () => {
            // Pre-fill all 4 healer slots
            const existingAssignments: RosterAssignmentResponse[] = [];
            for (let i = 1; i <= 4; i++) {
                existingAssignments.push(
                    makePoolPlayer({
                        signupId: 100 + i,
                        slot: 'healer',
                        position: i,
                        isOverride: false,
                    }),
                );
            }

            const pool = [
                makePoolPlayer({
                    signupId: 1,
                    preferredRoles: ['dps', 'healer'],
                    character: { id: 'c1', name: 'Char1', className: 'Mage', role: 'dps', avatarUrl: null },
                }),
            ];

            const result = computeAutoFill(pool, existingAssignments, mmoRoleSlots, mmoSlotCount, false);

            expect(result.totalFilled).toBe(1);
            const newAssignment = result.newAssignments.find(a => a.signupId === 1);
            expect(newAssignment).toBeDefined();
            expect(newAssignment!.slot).toBe('dps');
        });

        it('slots player with [dps, tank] prefs into tank when tank slot is open', () => {
            const pool = [
                makePoolPlayer({
                    signupId: 1,
                    preferredRoles: ['dps', 'tank'],
                    character: { id: 'c1', name: 'Char1', className: 'Warrior', role: 'dps', avatarUrl: null },
                }),
            ];

            const result = computeAutoFill(pool, [], mmoRoleSlots, mmoSlotCount, false);

            expect(result.totalFilled).toBe(1);
            const assignment = result.newAssignments[0];
            expect(assignment.slot).toBe('tank');
        });

        it('prefers tank over healer over DPS for a player with all three prefs', () => {
            const pool = [
                makePoolPlayer({
                    signupId: 1,
                    preferredRoles: ['dps', 'healer', 'tank'],
                    character: { id: 'c1', name: 'Char1', className: 'Paladin', role: 'dps', avatarUrl: null },
                }),
            ];

            const result = computeAutoFill(pool, [], mmoRoleSlots, mmoSlotCount, false);

            expect(result.totalFilled).toBe(1);
            const assignment = result.newAssignments[0];
            expect(assignment.slot).toBe('tank');
        });

        it('does not affect single-role preference players', () => {
            const pool = [
                makePoolPlayer({
                    signupId: 1,
                    preferredRoles: ['dps'],
                    character: { id: 'c1', name: 'Char1', className: 'Mage', role: 'dps', avatarUrl: null },
                }),
            ];

            const result = computeAutoFill(pool, [], mmoRoleSlots, mmoSlotCount, false);

            expect(result.totalFilled).toBe(1);
            const assignment = result.newAssignments[0];
            expect(assignment.slot).toBe('dps');
        });

        it('rigid players (1 pref) are seated before flex players (2+ prefs)', () => {
            const pool = [
                makePoolPlayer({
                    signupId: 1,
                    preferredRoles: ['dps', 'healer'],
                    character: { id: 'c1', name: 'Char1', className: 'Paladin', role: 'dps', avatarUrl: null },
                }),
                makePoolPlayer({
                    signupId: 2,
                    preferredRoles: ['healer'],
                    character: { id: 'c2', name: 'Char2', className: 'Priest', role: 'healer', avatarUrl: null },
                }),
            ];

            const result = computeAutoFill(pool, [], mmoRoleSlots, mmoSlotCount, false);

            expect(result.totalFilled).toBe(2);
            const player1 = result.newAssignments.find(a => a.signupId === 1);
            const player2 = result.newAssignments.find(a => a.signupId === 2);
            // Rigid healer-only player gets healer first
            expect(player2!.slot).toBe('healer');
            // Flex player falls to next priority (healer slot still open, gets healer too)
            expect(player1!.slot).toBe('healer');
        });
    });
});
