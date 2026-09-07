/**
 * ROK-1474 (D4) — resolving an approval tie by top picks.
 *
 * The layer ABOVE `detectTies`, which is deliberately unmodified (D5):
 * detection still reports the raw approval tie, and resolution happens here,
 * at the two — and only two — places that consume it
 * (`guardTiebreakerOnTransition` and `checkVotingQuorum`). One resolver for
 * both, because a quorum that says "ready" while the transition guard throws
 * is exactly the deadlock ROK-1374 fixed.
 *
 * This never eliminates ties, it only makes them rarer (AC4). Anything it
 * cannot decide falls through to ROK-1374's hold, byte-for-byte unchanged.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { countStarsPerGame } from '../lineups-voting.helpers';
// Type-only: erased at compile time, so this does NOT create a require cycle
// with `tiebreaker-detect.helpers`, which imports this module at runtime.
import type { TieResult } from './tiebreaker-detect.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Top-pick tally keyed by game id. A missing key means zero stars. */
export type StarCounts = Record<number, number>;

/** Why an approval tie could not be broken by stars. */
export type StarUnresolvedReason = 'no-stars' | 'star-tie';

/**
 * The outcome of applying top picks to an approval tie.
 *
 * `starCounts` rides on BOTH variants: the readiness card renders them on the
 * unresolved path (D11) rather than pretending the group never starred.
 */
export type StarResolution =
  | {
      kind: 'winner';
      gameId: number;
      starCounts: StarCounts;
      reasoning: string;
    }
  | {
      kind: 'unresolved';
      starCounts: StarCounts;
      reason: StarUnresolvedReason;
    };

/**
 * Decide an approval tie from a top-pick tally. Pure — the database read is
 * `resolveApprovalTieByStars`, so every branch is table-testable.
 */
export function resolveTieFromStarCounts(
  tie: TieResult,
  starCounts: StarCounts,
): StarResolution {
  const tallies = tie.tiedGameIds.map((gameId) => ({
    gameId,
    stars: starCounts[gameId] ?? 0,
  }));
  // AC6 / D8 — the legacy guard, checked BEFORE any comparison. A ballot
  // cast before this story shipped has `rank IS NULL` on every row, so its
  // tally is all zeroes and must resolve exactly as it does today. Without
  // this the all-zero case would fall into the comparison below and report
  // `star-tie`, which is a different fact about the group.
  if (tallies.every((t) => t.stars === 0)) {
    return { kind: 'unresolved', starCounts, reason: 'no-stars' };
  }
  const sorted = [...tallies].sort((a, b) => b.stars - a.stars);
  const runnerUp = sorted[1]?.stars ?? -1;
  if (sorted[0].stars === runnerUp) {
    return { kind: 'unresolved', starCounts, reason: 'star-tie' };
  }
  return {
    kind: 'winner',
    gameId: sorted[0].gameId,
    starCounts,
    reasoning: buildReasoning(tie, sorted),
  };
}

/** Load the lineup's top-pick tally and apply it to a detected tie. */
export async function resolveApprovalTieByStars(
  db: Db,
  lineupId: number,
  tie: TieResult,
): Promise<StarResolution> {
  const rows = await countStarsPerGame(db, lineupId);
  const counts: StarCounts = {};
  for (const row of rows) counts[row.gameId] = row.starCount;
  return resolveTieFromStarCounts(tie, counts);
}

/**
 * The outcome's own reasoning line (AC3), or null when there is nothing
 * honest to say.
 *
 * D9 clause (b): the string is emitted ONLY when the star winner is the game
 * the lineup actually decided. An operator naming a winner by hand skips tie
 * detection entirely (`tiebreaker-detect.helpers.ts:60`), and narrating that
 * as a star victory would be the tool lying about a human's decision.
 */
export function describeStarOutcome(
  resolution: StarResolution,
  decidedGameId: number | null,
): string | null {
  if (resolution.kind !== 'winner') return null;
  if (decidedGameId === null || decidedGameId !== resolution.gameId) {
    return null;
  }
  return resolution.reasoning;
}

/** `tied on votes 5–5, won on top picks 4–1` — winner's stars first. */
function buildReasoning(
  tie: TieResult,
  sorted: { gameId: number; stars: number }[],
): string {
  const votes = tie.tiedGameIds.map(() => tie.voteCount).join('–');
  const stars = sorted.map((t) => t.stars).join('–');
  return `tied on votes ${votes}, won on top picks ${stars}`;
}
