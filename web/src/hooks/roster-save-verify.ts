/**
 * Roster save guard (ROK-2141). The roster PATCH replaces the whole roster, so
 * the UI may only say "saved" when the server's returned roster holds every
 * assignment the client sent, in the same slot and position. Anything else is
 * reported as an error — never a silent partial save.
 */
import type { RosterRole } from '@raid-ledger/contract';

/** The fields of a roster entry the guard compares. */
export interface RosterEntryLike {
    signupId: number;
    username: string;
    slot: RosterRole | null;
    position: number;
}

/** Entries the client cannot send because they carry no usable signup id. */
export function findUnsendableAssignments<T extends RosterEntryLike>(assignments: T[]): T[] {
    return assignments.filter((a) => !Number.isInteger(a.signupId) || a.signupId <= 0);
}

/** Sent assignments the server's roster does not hold in the same slot and position. */
export function findUnsavedAssignments<T extends RosterEntryLike>(
    sent: T[],
    saved: { assignments: RosterEntryLike[] },
): T[] {
    const savedById = new Map(saved.assignments.map((a) => [a.signupId, a]));
    return sent.filter((a) => {
        const match = savedById.get(a.signupId);
        return !match || match.slot !== a.slot || match.position !== a.position;
    });
}

function slotLabel(slot: RosterRole | null, position: number): string {
    if (slot === null) return `position ${position}`;
    return slot === 'player' ? `slot ${position}` : `${slot} ${position}`;
}

/** Error text naming each player that was not saved where the UI showed them. */
export function describeUnsavedAssignments(entries: RosterEntryLike[]): string {
    const names = entries.map((a) => `${a.username} to ${slotLabel(a.slot, a.position)}`);
    return `Couldn't save ${names.join(', ')} — the roster was not updated as shown`;
}
