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
