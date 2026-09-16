/**
 * Pure helpers for the phone "Manage poll" sheet (ROK-1584). Separate module
 * so `SchedulingManageSheet.tsx` exports components only (react-refresh).
 */
import type { MatchDetailResponseDto } from '@raid-ledger/contract';

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
