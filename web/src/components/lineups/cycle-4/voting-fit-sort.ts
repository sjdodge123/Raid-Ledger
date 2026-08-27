/**
 * "Fits our group" sort assist for the Sv voting leaderboard
 * (ROK-1401 / rok-275 usage plan §2e — the item the shipping batch
 * deferred to keep that diff under ten files).
 *
 * What it is: an OPT-IN re-ranking of the leaderboard that floats the games
 * whose Co-Optimus online co-op cap covers the whole voting group above the
 * ones that cannot hold everybody. What it is NOT: a filter, a hard gate, or
 * a per-row badge. The operator's 2026-08-21 scope pivot removed fit badges
 * from `VotingRow`; nothing here puts one back — the signal is expressed
 * purely as order, and only while the viewer asks for it.
 *
 * The fit CLAIM follows the same rule every shipped ROK-1401 surface uses:
 * Co-Optimus-verified ONLY. `cooptimusOnlineMax` is the single source, a
 * positive value is the only claim, and IGDB `playerCount` is NEVER
 * consulted — a lobby size is not a co-op capability, and blending the two
 * is exactly what would let a 100-player PvP shooter present itself as the
 * game that fits your group of six. `0` (synced, no online co-op) and
 * `null`/`undefined` (never synced) are both "no claim" and sort with the
 * rest rather than being hidden.
 *
 * Vote order is the leaderboard's real ranking and stays authoritative
 * INSIDE each group: the assist decides which group a row lands in, never
 * how rows rank against each other within one.
 */
import type { LineupEntryResponseDto } from '@raid-ledger/contract';

/** Options for {@link sortForLeaderboard}. */
export interface LeaderboardSortOptions {
  /** Float entries that fit the group above the ones that do not. */
  fitsFirst: boolean;
  /** The group to fit — always `lineup.votingEligibleCount`. */
  groupSize: number;
}

/** A finite, positive Co-Optimus online cap, else null. */
function onlineCap(entry: LineupEntryResponseDto): number | null {
  const max = entry.cooptimusOnlineMax;
  return typeof max === 'number' && Number.isFinite(max) && max > 0
    ? max
    : null;
}

/**
 * Does this game's Co-Optimus online co-op cap cover the whole group?
 * False whenever there is no verified claim, and false for a non-positive
 * `groupSize` — with no group to measure against, fit is unanswerable
 * rather than true.
 */
export function coopFitsGroup(
  entry: LineupEntryResponseDto,
  groupSize: number,
): boolean {
  if (!Number.isFinite(groupSize) || groupSize <= 0) return false;
  const cap = onlineCap(entry);
  return cap != null && cap >= groupSize;
}

/**
 * Is there any Co-Optimus co-op data on this board at all? Gates the whole
 * control: before the sync has run there is nothing to sort by, so the
 * leaderboard renders exactly as it did pre-ROK-1401.
 */
export function anyCoopFitData(entries: LineupEntryResponseDto[]): boolean {
  return entries.some((entry) => onlineCap(entry) != null);
}

/** Vote count desc, owner count desc as the tiebreaker (the base ranking). */
function byVotes(
  a: LineupEntryResponseDto,
  b: LineupEntryResponseDto,
): number {
  if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
  return b.ownerCount - a.ownerCount;
}

/**
 * Order the leaderboard. Always ranks by votes first; when `fitsFirst` is
 * set, stable-partitions the ranked list so fitting games lead. Returns a
 * new array — the caller's is never mutated — and always returns every
 * entry it was given.
 */
export function sortForLeaderboard(
  entries: LineupEntryResponseDto[],
  { fitsFirst, groupSize }: LeaderboardSortOptions,
): LineupEntryResponseDto[] {
  const ranked = [...entries].sort(byVotes);
  if (!fitsFirst) return ranked;
  const fits = ranked.filter((entry) => coopFitsGroup(entry, groupSize));
  const rest = ranked.filter((entry) => !coopFitsGroup(entry, groupSize));
  return [...fits, ...rest];
}
