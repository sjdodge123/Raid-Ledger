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
 * 1. NET SCORE descending (`voteCount - noCount`) — the most-wanted time
 *    leads (ROK-1617, operator ruling: net score, not yes-only, not a ratio,
 *    and emphatically not a veto). A time 3 yes / 1 no (net 2) loses to
 *    3 yes / 0 no (net 3), and an all-`no` slot sinks below an unanswered one.
 * 2. `proposedTime` ascending — a tie is won by the EARLIEST time
 *    (`SLOT_TIE_RULE`, the copy every surface shows for that rule).
 * 3. `id` ascending — a total order, so two slots proposed for the same
 *    instant can never swap between surfaces or between renders.
 */

/** The minimum shape the comparator orders. Map to it at the call site. */
export interface SchedulingSlotOrderKey {
    id: number;
    proposedTime: string | Date;
    /** YES votes. Never the row count of a mixed-stance vote list. */
    voteCount: number;
    /**
     * ROK-1617: NO votes. Optional so every pre-stance call site keeps its
     * exact old ordering (absent → 0 → net score collapses to `voteCount`).
     */
    noCount?: number;
}

/**
 * A slot's net score: yes minus no (ROK-1617).
 *
 * The ONE definition — the comparator, the web page and the Discord card all
 * read it, so "leading" cannot mean two different things on two surfaces.
 *
 * @param slot - Slot carrying the vote counts.
 * @returns `voteCount - noCount`; may be negative when a slot is mostly `no`.
 */
export function slotNetScore(slot: SchedulingSlotOrderKey): number {
    return slot.voteCount - (slot.noCount ?? 0);
}

/**
 * The LEADER FLOOR (ROK-1617 item D, operator ruling "No time worked").
 *
 * A slot is eligible to be called "the leading time" only when more members
 * said it works than said it does not. The expiry DM, Rally and the web
 * leading card all gate on THIS function — a second opinion here is the
 * web/server divergence that was a reviewer MAJOR on ROK-1618.
 *
 * Ruling D-Q1: net 0 with yes votes (2 yes / 2 no) does NOT lead — a tie of
 * yes and no is not a mandate. Flip the comparison here if that is overruled.
 *
 * Deliberately NOT applied to lock-in's own candidate list (ruling D-Q3): an
 * organiser may still hand-lock a contested time.
 *
 * @param slot - Slot carrying the vote counts.
 * @returns True when `slotNetScore(slot) > 0`.
 */
export function leadsAtAll(slot: SchedulingSlotOrderKey): boolean {
    return slotNetScore(slot) > 0;
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
 * Compare two scheduling slots: net score desc, proposed time asc, id asc.
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
        slotNetScore(b) - slotNetScore(a) ||
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
