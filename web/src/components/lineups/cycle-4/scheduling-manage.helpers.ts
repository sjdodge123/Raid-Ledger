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

/** The shape {@link rallyPendingCount} reads off a poll-page slot. */
export interface RallySlotStances {
  proposedTime: string;
  votes: { userId: number }[];
  noVotes?: { userId: number }[];
}

export interface RallyPendingArgs {
  members: { userId: number }[] | undefined;
  slots: RallySlotStances[];
  /** The organiser pressing Rally — the server never nudges them. */
  viewerId: number | null;
  now?: number;
}

/**
 * The Rally nudge's audience, derived the way the SERVER derives it: members
 * with no stance — YES or NO (ROK-1617) — on any slot that is still in the
 * future. `pendingVoterCount` cannot answer this: `uniqueVoterCount` has no
 * time filter, so a member whose only vote is on a slot that has since passed
 * reads as answered and the Rally row disables itself with "Everyone has
 * voted" while the server still has the whole roster to nudge.
 *
 * `undefined` (the row draws no subline and stays enabled, letting the
 * server's answer drive the toast) when the members are unknown or no future
 * slot exists — better an enabled row than a wrong count.
 */
export function rallyPendingCount(args: RallyPendingArgs): number | undefined {
  const { members, slots, viewerId, now = Date.now() } = args;
  if (members == null) return undefined;
  const future = slots.filter((s) => Date.parse(s.proposedTime) > now);
  if (future.length === 0) return undefined;
  const answered = new Set<number>();
  for (const slot of future) {
    for (const v of slot.votes) answered.add(v.userId);
    for (const v of slot.noVotes ?? []) answered.add(v.userId);
  }
  return members.filter(
    (m) => m.userId !== viewerId && !answered.has(m.userId),
  ).length;
}
