/**
 * From-match cross-reference derivation for the ROK-1300 Scheduling composite.
 *
 * Computes "Match N of M" + the next game's name from the lineup's grouped
 * matches (`useLineupMatches`). Standalone polls pass `null` and render no
 * cross-refs.
 */
import type { GroupedMatchesResponseDto } from '@raid-ledger/contract';
import type { SchedulingCrossRefs } from './scheduling-hero';

/**
 * Derive cross-refs for the current match within the scheduling group.
 * Returns null when matches haven't loaded, the match isn't in the group, or
 * there's only one scheduling match (no N-of-M to show).
 */
export function deriveCrossRefs(
  matchId: number,
  groups: GroupedMatchesResponseDto | undefined,
): SchedulingCrossRefs | null {
  const scheduling = groups?.scheduling ?? [];
  if (scheduling.length <= 1) return null;
  const idx = scheduling.findIndex((m) => m.id === matchId);
  if (idx === -1) return null;
  const next = scheduling[idx + 1];
  return {
    matchIndex: idx + 1,
    matchTotal: scheduling.length,
    nextGameName: next?.gameName ?? null,
  };
}
