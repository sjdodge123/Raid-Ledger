/**
 * ROK-1474 (A15) — the star projection on the lineup detail response.
 *
 * Its own file because `lineups-response.helpers.ts` sits at 286/300 counted
 * lines: threading three more fields through `mapEntry` +
 * `mapToDetailResponse` would breach the ESLint cap in the same commit that
 * added them. It is also the natural seam — this is the ONE place that
 * decides what star information a given reader is allowed to see.
 *
 * **Operator ruling (2026-09-05 21:55Z): stars are private until the
 * outcome.** While the ballot is live the response carries only the viewer's
 * own pick; per-game counts stay `null`. `null` is not zero, and clients must
 * not render it as one.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { countStarsPerGame, findUserStar } from './lineups-voting.helpers';
import { detectTies } from './tiebreaker/tiebreaker-detect.helpers';
import {
  describeStarOutcome,
  resolveTieFromStarCounts,
  type StarCounts,
} from './tiebreaker/tiebreaker-star.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The subset of the lineup row this projection reads. */
export interface StarProjectionLineup {
  id: number;
  status: string;
  decidedGameId: number | null;
}

/**
 * Whether per-game top-pick counts may cross the wire for this lineup.
 *
 * A live star count is a stronger bandwagon signal than a live vote count —
 * it is scarce and single-use — so it is withheld until the ballot can no
 * longer be changed by what it reveals. A tie-held lineup is still `voting`
 * and stays undisclosed HERE; its counts reach the group through the
 * readiness card (D11), which is the surface the hold actually opens.
 */
export function areStarCountsDisclosed(
  lineup: Pick<StarProjectionLineup, 'status'>,
): boolean {
  return lineup.status === 'decided' || lineup.status === 'archived';
}

/**
 * Populate `myTopPickGameId`, `decisionReason` and — once disclosed — every
 * entry's `starCount`, mutating the assembled detail in place.
 */
export async function applyStarProjection(
  db: Db,
  lineup: StarProjectionLineup,
  detail: LineupDetailResponseDto,
  userId?: number,
): Promise<void> {
  detail.myTopPickGameId = await findUserStar(db, lineup.id, userId);
  detail.decisionReason = null;
  if (!areStarCountsDisclosed(lineup)) return;
  const counts = await loadStarCounts(db, lineup.id);
  for (const entry of detail.entries) {
    entry.starCount = counts[entry.gameId] ?? 0;
  }
  detail.decisionReason = await deriveDecisionReason(db, lineup, counts);
}

/** Top picks per game, as the resolver's plain record. */
export async function loadStarCounts(
  db: Db,
  lineupId: number,
): Promise<StarCounts> {
  const rows = await countStarsPerGame(db, lineupId);
  const counts: StarCounts = {};
  for (const row of rows) counts[row.gameId] = row.starCount;
  return counts;
}

/**
 * Re-derive why the decided game won (D9). Nothing is stored: votes freeze
 * when a lineup leaves `voting` (`runToggleVote` rejects every other status),
 * so the derivation is stable forever and cannot drift from a column.
 *
 * Returns null unless a real approval tie existed AND the stars broke it AND
 * the winner they name is the game the lineup actually decided.
 */
export async function deriveDecisionReason(
  db: Db,
  lineup: StarProjectionLineup,
  counts: StarCounts,
): Promise<string | null> {
  if (lineup.status !== 'decided' || lineup.decidedGameId === null) return null;
  const tie = await detectTies(db, lineup.id);
  if (!tie) return null;
  return describeStarOutcome(
    resolveTieFromStarCounts(tie, counts),
    lineup.decidedGameId,
  );
}
