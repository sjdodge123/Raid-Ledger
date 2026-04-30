/**
 * Majority-voter threshold helpers for the scheduling poll page (ROK-1121).
 *
 * Gates the "Create Event" / "Reschedule Event" actions behind a real
 * participation floor so a single voter cannot lock in a time slot.
 */
import type {
    MatchDetailResponseDto,
    ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';

export interface ThresholdUser {
    id?: number;
    role?: string;
}

/** Required voters: max(2, floor(N/2) + 1). */
export function computeRequiredVoters(memberCount: number): number {
    return Math.max(2, Math.floor(memberCount / 2) + 1);
}

/** Distinct voter count on the currently-selected slot. */
export function countDistinctVoters(
    slot: ScheduleSlotWithVotesDto | undefined,
): number {
    if (!slot) return 0;
    return new Set(slot.votes.map((v) => v.userId)).size;
}

/** True if the user can override the gate (operator, admin, or lineup creator). */
export function canBypassThreshold(
    user: ThresholdUser | null | undefined,
    match: MatchDetailResponseDto,
): boolean {
    if (!user) return false;
    if (user.role === 'operator' || user.role === 'admin') return true;
    return (
        typeof match.lineupCreatedById === 'number' &&
        match.lineupCreatedById === user.id
    );
}
