/**
 * Display counts for quorum-relevant copy (ROK-1253 side fix).
 *
 * The header and hero used `lineup.totalMembers` (community-wide) or a
 * hardcoded `/20` for the "X of Y nominated" framing — both wrong for
 * private lineups, whose expected-voter set is `createdBy + invitees`.
 *
 * Mirrors `api/src/lineups/quorum/quorum-voters.helpers.ts` semantics so
 * UI counts match what the backend uses to gate auto-advance.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';

/** Number of users whose participation gates auto-advance for this lineup. */
export function getExpectedVoterCount(
  lineup: Pick<LineupDetailResponseDto, 'visibility' | 'totalMembers' | 'createdBy' | 'invitees'>,
): number {
  if (lineup.visibility !== 'private') return lineup.totalMembers;
  const ids = new Set<number>([
    lineup.createdBy.id,
    ...lineup.invitees.map((i) => i.id),
  ]);
  return ids.size;
}

/** Number of distinct users who have made at least one nomination. */
export function getDistinctNominatorCount(
  lineup: Pick<LineupDetailResponseDto, 'entries'>,
): number {
  return new Set(lineup.entries.map((e) => e.nominatedBy.id)).size;
}
