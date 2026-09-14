/**
 * The ONE ordering rule for scheduling-poll slots (ROK-1548, audit F-03).
 *
 * The web poll page, the Discord embed and lock-in's fallback all used to sort
 * their own way — the web broke ties by time, the embed had no secondary key
 * at all (so ties fell to DB order) and lock-in read `sortedSlots[0]`. The same
 * poll could show two different "winners" and lock in a third. Everything that
 * orders slots now goes through this module.
 *
 * The keys, in order:
 * 1. `voteCount` descending — the most-wanted time leads.
 * 2. `proposedTime` ascending — a tie is won by the EARLIEST time
 *    (`SLOT_TIE_RULE`, the copy every surface shows for that rule).
 * 3. `id` ascending — a total order, so two slots proposed for the same
 *    instant can never swap between surfaces or between renders.
 */

/** The minimum shape the comparator orders. Map to it at the call site. */
export interface SchedulingSlotOrderKey {
    id: number;
    proposedTime: string | Date;
    voteCount: number;
}

/**
 * Copy for the tie rule this comparator implements. Any surface that explains
 * a tie MUST render this string rather than restating the rule in its own
 * words — a divergence here is how the surfaces drifted in the first place.
 */
export const SLOT_TIE_RULE = 'Tied — the earliest time wins.';

/** Epoch milliseconds for either representation of a proposed time. */
function instantMs(value: string | Date): number {
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Compare two scheduling slots: votes desc, then proposed time asc, then id asc.
 *
 * @param a - Left slot.
 * @param b - Right slot.
 * @returns Negative when `a` sorts first, positive when `b` does, never 0 for
 *          two distinct slot ids.
 */
export function compareSchedulingSlots(
    a: SchedulingSlotOrderKey,
    b: SchedulingSlotOrderKey,
): number {
    return (
        b.voteCount - a.voteCount ||
        instantMs(a.proposedTime) - instantMs(b.proposedTime) ||
        a.id - b.id
    );
}

/**
 * Sort slots into the shared display order without mutating the input.
 *
 * @param slots - Slots carrying at least the ordering keys.
 * @returns A new array in `compareSchedulingSlots` order.
 */
export function sortSchedulingSlots<T extends SchedulingSlotOrderKey>(
    slots: readonly T[],
): T[] {
    return [...slots].sort(compareSchedulingSlots);
}
