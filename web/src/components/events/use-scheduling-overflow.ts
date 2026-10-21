/**
 * ROK-1874: does locking this poll slot sign up more people than the roster
 * holds?
 *
 * The create form opened from "Lock this time" re-reads the poll it came from.
 * POST /events signs the creator up first, then completing the poll signs up
 * every yes-voter on the chosen slot; anyone past the cap is benched. The
 * arithmetic mirrors the API: `rostered = 1 + yes-voters excluding the
 * creator`, `cap = min(slotPlayer, maxAttendees)` over whichever is set and
 * > 0, `benched = max(0, rostered - cap)`. A generic Players count of 0 is
 * unreachable: the stepper's min is 1 (the API would bench every signup).
 */
import { useQuery } from '@tanstack/react-query';
import type {
    SchedulePollPageResponseDto,
    ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { getSchedulePoll } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import type { FormState } from './create-event-form.types';

export interface SchedulingOverflow {
    /** Yes-voters' display names, creator omitted, server order. */
    voters: string[];
    rostered: number;
    cap: number;
    benched: number;
    /** False when the creator did not vote for the slot (they still take a spot). */
    creatorVoted: boolean;
}

export interface RosterCapInput {
    slotType: FormState['slotType'];
    slotPlayer: number;
    maxAttendees: string;
}

/** Smallest positive cap among `slotPlayer` and `maxAttendees`; null when neither is set. */
export function resolveRosterCap(slotPlayer: number, maxAttendees: string): number | null {
    const max = parseInt(maxAttendees, 10);
    const caps = [slotPlayer, max].filter((n) => Number.isFinite(n) && n > 0);
    return caps.length > 0 ? Math.min(...caps) : null;
}

/** Find the slot by instant, the same rule as the backend's slot match. */
export function findSlotByTime(
    poll: SchedulePollPageResponseDto,
    startTime: string,
): ScheduleSlotWithVotesDto | undefined {
    const want = new Date(startTime).getTime();
    return poll.slots.find((s) => new Date(s.proposedTime).getTime() === want);
}

/** Pure overflow arithmetic; null when nothing will be benched or it can't be computed. */
export function computeSchedulingOverflow(
    slot: ScheduleSlotWithVotesDto | undefined,
    creatorId: number | null,
    roster: RosterCapInput,
): SchedulingOverflow | null {
    if (!slot || roster.slotType === 'mmo') return null;
    const cap = resolveRosterCap(roster.slotPlayer, roster.maxAttendees);
    if (cap === null) return null;
    const seen = new Set<number>();
    const voters: string[] = [];
    for (const v of slot.votes) {
        if (v.userId === creatorId || seen.has(v.userId)) continue;
        seen.add(v.userId);
        voters.push(v.displayName);
    }
    const rostered = 1 + voters.length;
    const benched = Math.max(0, rostered - cap);
    if (benched === 0) return null;
    const creatorVoted = slot.votes.some((v) => v.userId === creatorId);
    return { voters, rostered, cap, benched, creatorVoted };
}

export interface SchedulingOverflowParams extends RosterCapInput {
    lineupId: number | null | undefined;
    matchId: number | null | undefined;
    startTime: string | null | undefined;
}

/** Live overflow for the create form; null while loading, on error, or when nothing overflows. */
export function useSchedulingOverflow(params: SchedulingOverflowParams): SchedulingOverflow | null {
    const { lineupId, matchId, startTime } = params;
    const { user } = useAuth();
    const enabled = !!lineupId && !!matchId && !!startTime;
    const { data } = useQuery({
        queryKey: ['scheduling', 'poll', lineupId, matchId],
        queryFn: () => getSchedulePoll(lineupId ?? 0, matchId ?? 0),
        enabled,
    });
    if (!enabled || !data || !startTime) return null;
    return computeSchedulingOverflow(findSlotByTime(data, startTime), user?.id ?? null, params);
}
