/**
 * Group size for the co-op roster-fit flags (ROK-1444; shared by TD batch 4
 * B1 so the Nominate modal and the nomination cards agree).
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useCommonGround, useLineupDetail } from '../../hooks/use-lineups';

/**
 * Base is Common Ground's `participantCount` — the people actually IN this
 * lineup (nominators + voters, or invitees + creator when private) — NOT
 * `votingEligibleCount`, which on a public lineup is the whole community and
 * flagged every co-op game on the dev env ("group is 249").
 *
 * Codex P2: that count only reaches public invitees once they nominate or
 * vote, so a public lineup seeded with explicit invitees (ROK-1440) reported
 * `participantCount = 1` and stayed silent for a group of five. Take the
 * larger of the two views; for a private lineup `participantCount` is already
 * invitees + creator, so the max is a no-op there.
 *
 * Returns undefined below two people: a "group" of one cannot outgrow a co-op
 * cap, and flagging a synced-zero game at "group is 1" would be noise.
 */
export function rosterSize(
  lineup: Pick<LineupDetailResponseDto, 'invitees' | 'createdBy'>,
  participantCount: number,
): number | undefined {
  // Codex round-5 P2: count DISTINCT people. `addInvitees` does not exclude
  // the creator, so a creator who is also in the invitee list would otherwise
  // be counted twice and report the group one person too large — enough to
  // wrongly flag a 4-player co-op game for a real four-person roster.
  const invited = new Set(lineup.invitees.map((i) => i.id));
  invited.add(lineup.createdBy.id);
  const size = Math.max(participantCount, invited.size);
  return size >= 2 ? size : undefined;
}

/**
 * Roster size for a Nominate modal opened outside the nominating composite
 * (games-page banner, detail-page Nominate). Fetches nothing until `enabled`
 * (the modal is open); `participantCount` is filter-independent, so a
 * one-row Common Ground page at the default filters is enough (minOwners 0
 * would make the server scan the whole catalogue just to fill `meta`).
 */
export function useNominateRosterSize(
  lineupId: number,
  enabled: boolean,
): number | undefined {
  const { data: lineup } = useLineupDetail(enabled ? lineupId : undefined);
  const { data: commonGround } = useCommonGround(
    { lineupId, limit: 1 },
    enabled,
  );
  if (!lineup) return undefined;
  return rosterSize(lineup, commonGround?.meta.participantCount ?? 0);
}
