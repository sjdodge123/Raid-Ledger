/**
 * Cohort-memory read path (ROK-1309 S4) — `GET /lineups/:id/cohort-memory`.
 *
 * Answers "has this exact group resolved a game together before?" for the
 * lineup currently being nominated/voted on.
 *
 * ## Exact-set equality, not containment
 *
 * The lookup key is `(participant_hash, cohort_size)` — the same pair the
 * write path stamps on every row (`cohort-memory-signature.helpers.ts`). A
 * 3-person cohort `{A,B,C}` therefore does NOT match the 4-person `{A,B,C,D}`
 * nor the 2-person `{A,B}`: different member set -> different hash, and a
 * differing size cannot be reached even through a hash collision. Membership
 * is order-independent because the signature sorts numerically before
 * hashing. The GIN index on `participant_ids` is for diagnostics; the read
 * path never uses containment operators.
 *
 * ## `veto_lost` is filtered HERE, at the API layer
 *
 * Veto losers are persisted (ROK-1310's insights panel consumes them) but
 * never surfaced in-lineup. The contract narrows `CohortMemoryEntrySchema`'s
 * `resolution` to the three positive outcomes, so a `veto_lost` row reaching
 * the client would be a contract violation rather than something the UI has
 * to remember to hide.
 *
 * ## The CURRENT lineup is never its own memory
 *
 * An operator revert (`decided -> voting`, `VALID_REVERSIONS`) leaves behind
 * the rows the decided transition already wrote with `source_lineup_id` = this
 * lineup. Matching on `(participant_hash, cohort_size)` alone would then hand
 * the lineup its own just-decided games back as "played with this group
 * before". `queryCohortMemory` therefore excludes `source_lineup_id =
 * lineupId`; only PRIOR lineups are memory.
 *
 * Sibling style: `common-ground-query.helpers.ts`.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CohortMemoryEntryDto,
  CohortMemoryResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  loadCohortSignature,
  type CohortSignature,
} from './cohort-memory-signature.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Strongest badge wins when two rows for one game share a timestamp. */
const RESOLUTION_RANK = sql`CASE m.resolution
  WHEN 'decided' THEN 0
  WHEN 'veto_won' THEN 1
  ELSE 2
END`;

/** Raw row shape returned by `queryCohortMemory`. */
export interface CohortMemoryRow {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  resolution: 'decided' | 'match' | 'veto_won';
  sourceLineupId: number;
  lastResolvedAt: Date | string;
}

/**
 * One card per remembered game, newest resolution first.
 *
 * A cohort can resolve the same game more than once (a `match` in one lineup,
 * `decided` in the next). `DISTINCT ON (game_id)` collapses those to the most
 * recent row, so `lastResolvedAt` IS the last time this group landed on it.
 * The resolution tiebreak keeps the outcome deterministic when two rows share
 * a timestamp — a `decided` + `match` pair written by the SAME transition has
 * exactly that shape, and the stronger badge should win.
 *
 * @param lineupId - The lineup being viewed. Its OWN rows are excluded so a
 * reverted lineup cannot recommend the games it just decided.
 */
export async function queryCohortMemory(
  db: Db,
  sig: CohortSignature,
  lineupId: number,
): Promise<CohortMemoryRow[]> {
  const rows = (await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (m.game_id)
        m.game_id AS "gameId",
        g.name AS "gameName",
        g.cover_url AS "gameCoverUrl",
        m.resolution AS "resolution",
        m.source_lineup_id AS "sourceLineupId",
        m.created_at AS "lastResolvedAt"
      FROM community_lineup_cohort_memory m
      JOIN games g ON g.id = m.game_id
      WHERE m.participant_hash = ${sig.participantHash}
        AND m.cohort_size = ${sig.cohortSize}
        AND m.resolution <> 'veto_lost'
        AND m.source_lineup_id <> ${lineupId}
      ORDER BY m.game_id, m.created_at DESC, ${RESOLUTION_RANK}
    ) remembered
    ORDER BY "lastResolvedAt" DESC, "gameName" ASC
  `)) as unknown as CohortMemoryRow[];
  return [...rows];
}

/** Map a raw row onto the published contract DTO. */
export function mapCohortMemoryRow(row: CohortMemoryRow): CohortMemoryEntryDto {
  return {
    gameId: Number(row.gameId),
    gameName: row.gameName,
    gameCoverUrl: row.gameCoverUrl ?? null,
    resolution: row.resolution,
    lastResolvedAt: new Date(row.lastResolvedAt).toISOString(),
    sourceLineupId: Number(row.sourceLineupId),
  };
}

/**
 * Build the full `GET /lineups/:id/cohort-memory` response.
 *
 * An empty cohort — zero nominators AND zero voters, which also covers a
 * lineup id that does not exist — has no signature to match on, so it yields
 * `{ cohortSize: 0, entries: [] }` rather than an error. The section simply
 * stays hidden.
 */
export async function buildCohortMemoryResponse(
  db: Db,
  lineupId: number,
): Promise<CohortMemoryResponseDto> {
  const sig = await loadCohortSignature(db, lineupId);
  if (!sig) return { cohortSize: 0, entries: [] };
  const rows = await queryCohortMemory(db, sig, lineupId);
  return {
    cohortSize: sig.cohortSize,
    entries: rows.map(mapCohortMemoryRow),
  };
}
