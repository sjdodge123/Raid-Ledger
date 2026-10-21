/**
 * ROK-1874: does locking this poll slot sign up more people than the roster
 * holds?
 *
 * The create form opened from "Lock this time" re-reads the poll it came from.
 * POST /events signs the creator up first, then completing the poll signs up
 * every yes-voter on the chosen slot; anyone past the cap is benched. The
 * arithmetic mirrors the API: `rostered = 1 + yes-voters excluding the
 * creator`, `cap` = Players when set, else Max Attendees (the backend's
 * `resolveEventCapacity` prefers the generic slotConfig over maxAttendees),
 * `benched = max(0, rostered - cap)`. A Players count of 0 is a real cap: the
 * stepper's min of 1 only clamps edits, and a saved template or copied event
 * can still carry 0 — the API then benches every signup, the creator's too.
 *
 * The poll stays live while the form is open: the same `lineup:<id>` socket
 * the poll page uses (ROK-1551), with its 10s fallback while disconnected.
 */
import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
    SchedulePollPageResponseDto,
    ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { getSchedulePoll } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { schedulePollKey } from '../../hooks/use-scheduling';
import { liveRefetchInterval, useSchedulePollRealtime } from '../../hooks/use-schedule-poll-realtime';
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

/**
 * Mirrors `resolveEventCapacity` (api/src/events/signups-signup.helpers.ts):
 * the generic slotConfig's `player` wins, 0 included (`computeSlotCapacity`
 * returns it as-is); `maxAttendees` is the cap only when Players is not a
 * number. Null when neither is set.
 */
export function resolveRosterCap(slotPlayer: number, maxAttendees: string): number | null {
    if (Number.isFinite(slotPlayer) && slotPlayer >= 0) return slotPlayer;
    const max = parseInt(maxAttendees, 10);
    return Number.isFinite(max) && max > 0 ? max : null;
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
    const connectedRef = useRef(false);
    const { data } = useQuery({
        queryKey: schedulePollKey(lineupId ?? 0, matchId ?? 0),
        queryFn: () => getSchedulePoll(lineupId ?? 0, matchId ?? 0),
        enabled,
        refetchInterval: (q) => (enabled ? liveRefetchInterval(q.state.data, connectedRef.current) : false),
        refetchIntervalInBackground: false,
    });
    useSchedulePollRealtime(lineupId ?? 0, matchId ?? 0, enabled && data?.pollStatus === 'open', connectedRef);
    if (!enabled || !data || !startTime) return null;
    return computeSchedulingOverflow(findSlotByTime(data, startTime), user?.id ?? null, params);
}
