/**
 * Slot ordering + leader/tie derivation for the scheduling poll (ROK-1543).
 *
 * Layout B promotes the winning slot into a decision card, so "which slot is
 * leading" and "are the top two level" have to be answered in exactly ONE
 * place — the card, the ladder and the tests must never disagree.
 *
 * `sortSlots` is the web's current comparator (votes desc, then proposed time
 * asc). ROK-1548 replaces it with the shared comparator used by the Discord
 * embed: swap the body/import HERE and every consumer follows.
 */
import {
    leadsAtAll,
    slotNetScore,
    sortSchedulingSlots,
} from '@raid-ledger/contract';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';

/** Sort slots by votes desc, then proposed time asc. Never mutates `slots`. */
/**
 * Sort slots through the ONE shared comparator (ROK-1548): votes desc, then
 * proposed time asc, then id asc. The Discord embed and lock-in's fallback
 * call the same function, so all three surfaces name the same winner (F-03).
 */
export function sortSlots(
    slots: ScheduleSlotWithVotesDto[],
): ScheduleSlotWithVotesDto[] {
    return sortSchedulingSlots(
        slots.map((slot) => ({
            ...slot,
            voteCount: slot.votes.length,
            // ROK-1617: without this the comparator defaults `noCount` to 0 and
            // an anti-vote is stored but silently ignored by "leading".
            noCount: noCountOf(slot),
        })),
    );
}

/**
 * Anti-votes on a slot.
 *
 * Defensive on purpose: the poll response is consumed as raw JSON (no zod
 * parse on this path), so a payload cached by a client that predates the
 * stance column arrives without the array. Absent means nobody said no.
 */
function noCountOf(slot: ScheduleSlotWithVotesDto): number {
    return slot.noVotes?.length ?? 0;
}

/** Map a poll slot onto the shared comparator's minimum shape. */
function orderKeyOf(slot: ScheduleSlotWithVotesDto) {
    return {
        id: slot.id,
        proposedTime: slot.proposedTime,
        voteCount: slot.votes.length,
        noCount: noCountOf(slot),
    };
}

/** A slot's net score (yes minus no) through the ONE shared definition. */
function netScore(slot: ScheduleSlotWithVotesDto): number {
    return slotNetScore(orderKeyOf(slot));
}

export interface SchedulingLeader {
    /** The winning slot under {@link sortSlots}. */
    slot: ScheduleSlotWithVotesDto;
    /** YES votes cast on the winning slot. */
    votes: number;
    /** ROK-1617: members who said the winning time does not work for them. */
    noVotes: number;
    /**
     * The runner-up has the same vote count, so the tiebreak (earliest time
     * wins) is what decides it. A 0-0 "tie" before anyone has voted is not a
     * tie — it is an empty poll, and the card says so instead.
     */
    tied: boolean;
}

/** True when somebody has answered the poll — either stance, any slot. */
function pollHasAnswers(slots: ScheduleSlotWithVotesDto[]): boolean {
    return slots.some(
        (slot) => slot.votes.length > 0 || noCountOf(slot) > 0,
    );
}

/**
 * Derive the leading slot from an unsorted slot list.
 *
 * ROK-1617 item D (operator: "No time worked"): once the group HAS answered,
 * the top slot only leads when it clears the shared `leadsAtAll` floor (more
 * yes than no) — the same predicate the expiry DM and Rally gate on, so the
 * page can never crown a time the server refuses to rally around. A poll
 * nobody has answered keeps its provisional top slot, which is what the
 * card's "no votes yet" state renders.
 *
 * Cross-surface review (ROK-1617 follow-up, item 3): the server's
 * `pickLeadingFutureSlot` only ever considers times that are still AHEAD, so
 * a web card that ranked past slots too could name a time Rally then refuses
 * with a 400. The candidate pool is therefore the future slots — falling back
 * to every slot when none is ahead, so a locked-in or expired poll still
 * names the time it ran on (and the card's "This time has already passed."
 * marker still has something to mark) instead of claiming nothing worked.
 *
 * @param slots - Every proposed slot, unsorted.
 * @param now - Epoch ms treated as "now"; injectable so a spec can place a
 *              slot either side of it without waiting for the clock.
 * @returns the leader, or `null` when no time has been proposed or none has
 *          net support.
 */
export function deriveSchedulingLeader(
    slots: ScheduleSlotWithVotesDto[],
    now: number = Date.now(),
): SchedulingLeader | null {
    const future = slots.filter((s) => Date.parse(s.proposedTime) > now);
    const pool = future.length > 0 ? future : slots;
    const sorted = sortSlots(pool);
    const top = sorted[0];
    if (!top) return null;
    if (pollHasAnswers(pool) && !leadsAtAll(orderKeyOf(top))) return null;
    const votes = top.votes.length;
    const runnerUp = sorted[1];
    // ROK-1617: level on NET score, which is what the comparator ranks on —
    // a 3-yes/1-no leader is NOT tied with a 3-yes/0-no runner-up.
    const tied =
        votes > 0 &&
        runnerUp !== undefined &&
        netScore(runnerUp) === netScore(top);
    return { slot: top, votes, noVotes: noCountOf(top), tied };
}
