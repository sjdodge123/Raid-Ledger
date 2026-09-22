/**
 * ONE leader identity for the whole scheduling surface (ROK-1635 AC1).
 *
 * Before this hook the page derived the leading time TWICE — once in the
 * composite for the card's vote controls (`deriveSchedulingLeader`) and once
 * inside the card for the time it names (`resolveCardLeader`). On a locked-in
 * or expired poll those two disagree by design (§1.1), so hiding the row the
 * composite's copy named would have hidden the WRONG row.
 *
 * Hoisting the card's own resolver is what makes "the leader shows exactly
 * once" structural: the card's `leader` and the ladder's `excludeSlotId` come
 * out of the SAME memo, so an optimistic vote that moves the lead moves both
 * in one React commit — never a frame with both rows or neither (§4.4).
 */
import { useMemo } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { resolveCardLeader, type SchedulingLeader } from './scheduling-leader';

export interface SchedulingCardLeader {
    /** The time the leader card names, or `null` when none leads. */
    leader: SchedulingLeader | null;
    /** That time's slot id — the row the ladder must not list a second time. */
    leaderSlotId: number | null;
}

/**
 * Derive the leading time once, for both the card and the ladder.
 *
 * @param poll - The scheduling poll page payload (its `slots` + `lockedInTime`).
 * @param readOnly - The poll no longer accepts votes (terminal or expired).
 * @returns the leader and its slot id; both `null` when no time leads.
 */
export function useSchedulingCardLeader(
    poll: SchedulePollPageResponseDto,
    readOnly: boolean,
): SchedulingCardLeader {
    const slots = poll.slots;
    const lockedInTime = poll.lockedInTime ?? null;
    return useMemo(() => {
        const leader = resolveCardLeader({ slots, readOnly, lockedInTime });
        return { leader, leaderSlotId: leader?.slot.id ?? null };
    }, [slots, readOnly, lockedInTime]);
}
