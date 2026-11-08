/**
 * ROK-2141 — the roster save guard: what the server says it saved must match
 * every assignment the client sent, or the save is reported as an error.
 */
import { describe, it, expect } from 'vitest';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { makePlayer } from '../components/roster/RosterBuilder.test-helpers';
import { findUnsendableAssignments, findUnsavedAssignments, describeUnsavedAssignments } from './roster-save-verify';

function placed(id: number, name: string, slot: RosterRole, position: number): RosterAssignmentResponse {
    return { ...makePlayer(id, null, name), slot, position };
}

describe('findUnsavedAssignments', () => {
    it('returns nothing when the server saved every assignment exactly', () => {
        const sent = [placed(1, 'Anon', 'dps', 1), placed(2, 'Tanky', 'tank', 1)];
        const saved = { assignments: [placed(2, 'Tanky', 'tank', 1), placed(1, 'Anon', 'dps', 1)] };
        expect(findUnsavedAssignments(sent, saved)).toEqual([]);
    });

    it('flags an assignment the server dropped', () => {
        const sent = [placed(1, 'Anon', 'dps', 1), placed(2, 'Tanky', 'tank', 1)];
        const saved = { assignments: [placed(2, 'Tanky', 'tank', 1)] };
        expect(findUnsavedAssignments(sent, saved).map((a) => a.username)).toEqual(['Anon']);
    });

    it('flags an assignment saved to a different slot or position', () => {
        const sent = [placed(1, 'Anon', 'dps', 1), placed(2, 'Tanky', 'tank', 1)];
        const saved = { assignments: [placed(1, 'Anon', 'dps', 2), placed(2, 'Tanky', 'healer', 1)] };
        expect(findUnsavedAssignments(sent, saved).map((a) => a.username)).toEqual(['Anon', 'Tanky']);
    });
});

describe('findUnsendableAssignments', () => {
    it('flags an entry with no usable signupId instead of dropping it', () => {
        const ok = placed(3, 'Fine', 'dps', 1);
        const broken = { ...placed(4, 'Ghost', 'dps', 2), signupId: 0 };
        expect(findUnsendableAssignments([ok, broken]).map((a) => a.username)).toEqual(['Ghost']);
    });
});

describe('describeUnsavedAssignments', () => {
    it('names each player and the slot they were meant to hold', () => {
        const text = describeUnsavedAssignments([placed(1, 'Anon', 'dps', 1), placed(5, 'Pal', 'player', 3)]);
        expect(text).toBe("Couldn't save Anon to dps 1, Pal to slot 3 — the roster was not updated as shown");
    });
});
