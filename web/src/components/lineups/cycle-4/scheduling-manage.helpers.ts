/**
 * Helpers for the "Manage poll" surfaces — the phone sheet (ROK-1584) and the
 * desktop dropdown (ROK-1585). Separate module so the component files export
 * components only (react-refresh).
 */
import { leadsAtAll } from '@raid-ledger/contract';
import type {
  MatchDetailResponseDto,
  ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { sortSlots } from './scheduling-leader';

/**
 * Whether the viewer gets a "Manage poll ⋯" trigger at all: the poll's lineup
 * creator, operators and admins — never on a read-only poll. The same gates
 * the three actions apply individually.
 */
export function useCanManagePoll(
  match: MatchDetailResponseDto,
  readOnly: boolean,
): boolean {
  const { user } = useAuth();
  if (readOnly) return false;
  return isOperatorOrAdmin(user) || canBypassThreshold(user, match);
}

/**
 * Poll members who have not voted yet, or `undefined` when the two counts are
 * not both known — the Remind row then draws no subline rather than a wrong
 * one.
 */
export function pendingVoterCount(
  match: MatchDetailResponseDto,
  uniqueVoterCount: number | undefined,
): number | undefined {
  const members = match.members?.length;
  if (members == null || uniqueVoterCount == null) return undefined;
  return Math.max(0, members - uniqueVoterCount);
}

/**
 * The slot the SERVER will rally: the first, in the shared slot order, among
 * future slots that clear the shared leader floor — `leadsAtAll`, more YES
 * than NO (ROK-1617 item D, operator: "No time worked"). The SAME predicate
 * the API's `pickLeadingFutureSlot` filters on, imported rather than restated
 * so the row can never count a time the server answers 400 for.
 *
 * Deliberately NOT `deriveSchedulingLeader`: the leader card ranks every slot,
 * so with a top slot that has already passed, or a poll with no YES yet, the
 * card's leader is a slot the server never rallies — and the row would count
 * one time while the DM names another (or the server answers 400).
 *
 * @returns the slot id, or `null` when the server would answer "no leading
 *   time yet" — {@link rallyPendingCount} then reports `undefined`.
 */
export function rallyLeadingSlotId(
  slots: ScheduleSlotWithVotesDto[],
  now: number = Date.now(),
): number | null {
  const lockable = slots.filter(
    (s) =>
      Date.parse(s.proposedTime) > now &&
      leadsAtAll({
        id: s.id,
        proposedTime: s.proposedTime,
        voteCount: s.votes.length,
        noCount: s.noVotes?.length ?? 0,
      }),
  );
  return sortSlots(lockable)[0]?.id ?? null;
}

/** The shape {@link rallyPendingCount} reads off a poll-page slot. */
export interface RallySlotStances {
  id: number;
  votes: { userId: number }[];
  noVotes?: { userId: number }[];
}

export interface RallyPendingArgs {
  members: { userId: number }[] | undefined;
  slots: RallySlotStances[];
  /** The organiser pressing Rally — the server never nudges them. */
  viewerId: number | null;
  /**
   * The slot being rallied, or `null` when nothing is. ROK-1635 renamed this
   * from `leadingSlotId`: every row carries a Rally now, so the slot this
   * counts for is the row's own, not always the leader's.
   */
  slotId: number | null;
}

/**
 * The Rally nudge's audience: members with no stance — neither YES nor NO
 * (ROK-1617) — on the LEADING slot.
 *
 * Rally exists to get the leading time over the line, so a vote on some OTHER
 * time does not answer it. The first cut counted "no stance on any future
 * slot" and the operator rejected it on prod: the leader card read "3 of 4
 * members picked this time" while the Rally row sat disabled saying everyone
 * had voted, because the 4th member had voted on a different time — exactly
 * the member a rally exists to reach.
 *
 * `undefined` (the row draws no subline and stays enabled, letting the
 * server's answer drive the toast) when the members are unknown, no slot is
 * leading, or the leading id is not in `slots` — better an enabled row than a
 * wrong count.
 */
export function rallyPendingCount(args: RallyPendingArgs): number | undefined {
  const { members, slots, viewerId, slotId } = args;
  if (members == null || slotId == null) return undefined;
  const target = slots.find((s) => s.id === slotId);
  if (target === undefined) return undefined;
  const answered = new Set<number>();
  for (const v of target.votes) answered.add(v.userId);
  for (const v of target.noVotes ?? []) answered.add(v.userId);
  return members.filter(
    (m) => m.userId !== viewerId && !answered.has(m.userId),
  ).length;
}
