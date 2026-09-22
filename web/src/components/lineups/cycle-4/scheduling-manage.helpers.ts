/**
 * Helpers for the "Manage poll" surfaces — the phone sheet (ROK-1584) and the
 * desktop dropdown (ROK-1585). Separate module so the component files export
 * components only (react-refresh).
 */
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';

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

/*
 * ROK-1635 removed `rallyLeadingSlotId` (the server's leading-slot pick,
 * mirrored client-side). Every time card now rallies the time IT names, so the
 * count comes from that card's own slot id — `useSchedulingTimeMenus` passes
 * `slot.id` straight into {@link rallyPendingCount}. The mirror had no
 * production caller left, only its own tests.
 */

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
