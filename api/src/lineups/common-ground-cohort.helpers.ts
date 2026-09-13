/**
 * Common Ground `cohort` row (ROK-1538).
 *
 * The fourth themed row of the Nominating composite: games this lineup's
 * exact cohort — its ROSTER, `{createdBy} ∪ invitees ∪ nominators ∪ voters`
 * (`cohort-memory-signature.helpers.ts`) — has already resolved together in a
 * PRIOR lineup.
 *
 * ## One query helper, not a second SQL copy
 *
 * The remembered-game selection reuses `queryCohortMemory` verbatim — the
 * same helper `GET /lineups/:id/cohort-memory` goes through — so the two
 * surfaces cannot drift on the exclusions that matter: `veto_lost` filtered
 * out, the lineup's OWN rows excluded (an operator revert must not hand a
 * lineup back its just-decided games), and `DISTINCT ON (game_id)` collapsing
 * repeat resolutions to the newest with the decided > veto_won > match
 * tiebreak.
 *
 * ## Enrichment goes through the SAME path as every other tile
 *
 * A remembered game is frequently NOT in the candidate pool: the pool applies
 * `minOwners`, genre/search/player filters and a LIMIT, and a game the group
 * already played may satisfy none of them. Rather than hand the client a
 * second, thinner card shape, those games are re-read through
 * `queryCommonGroundByGameIds` — the identical SELECT body as the pool query,
 * only with a different WHERE — and mapped by `mapCommonGroundRow`. Tiles in
 * the cohort row therefore carry the same score breakdown, genres, owner
 * count, ITAD sale data, player range and viewer-personalization badges as
 * every other tile.
 *
 * A remembered game that IS already in the pool is RE-THEMED in place rather
 * than duplicated — one tile, theme `cohort`.
 *
 * `theme` is assigned explicitly here, never by `classifyTheme`: the cohort
 * signal comes from history, not from the score breakdown.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { loadCohortSignature } from './cohort-memory-signature.helpers';
import {
  queryCohortMemory,
  type CohortMemoryRow,
} from './cohort-memory-query.helpers';
import {
  mapCommonGroundRow,
  queryCommonGroundByGameIds,
  type ScoringContext,
} from './common-ground-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Most tiles the cohort row will ever render. The row is the FIRST thing in
 * the Common Ground hero, so an uncapped one buries every other row; 12 is a
 * full shelf at desktop width and still more than a group realistically wants
 * to scan. Games are dropped oldest-first (`lastResolvedAt DESC`).
 */
const COHORT_ROW_MAX = 12;

/** `MMM d` — the format the cohort whyReason stamps its date in. */
// prettier-ignore
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format `lastResolvedAt` as `Sep 13`.
 *
 * Deliberately UTC: the API has no viewer timezone at this layer, and a
 * locale-sensitive formatter would make the same row render two different
 * dates on two machines — which the integration spec would then only catch
 * near midnight.
 */
export function formatResolvedOn(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Per-resolution lead-in for the cohort whyReason. */
const COHORT_REASON_LEAD: Record<CohortMemoryRow['resolution'], string> = {
  decided: 'Decided together',
  match: 'Matched together',
  veto_won: 'Won the veto',
};

/**
 * `Decided together · Sep 13`. Capped at 80 chars to satisfy the Zod
 * `whyReason` ceiling; the longest possible output here is well under it,
 * the cap is a guard rather than a live constraint.
 */
export function buildCohortWhyReason(row: CohortMemoryRow): string {
  const lead = COHORT_REASON_LEAD[row.resolution] ?? 'Played together';
  const on = formatResolvedOn(row.lastResolvedAt);
  return (on ? `${lead} · ${on}` : lead).slice(0, 80);
}

/** Stamp the cohort theme + rationale onto an already-enriched tile. */
function asCohortTile(
  game: CommonGroundGameDto,
  row: CohortMemoryRow,
): CommonGroundGameDto {
  return {
    ...game,
    theme: 'cohort',
    whyReason: buildCohortWhyReason(row),
  };
}

/** What `applyCohortRow` hands back to the response builder. */
export interface CohortRowResult {
  /** Cohort tiles, newest resolution first. Rendered as the FIRST row. */
  cohortTiles: CommonGroundGameDto[];
  /** Pool tiles with any re-themed game removed (it moved to `cohortTiles`). */
  remainingPool: CommonGroundGameDto[];
}

/**
 * Split the scored pool into (cohort row, everything else).
 *
 * @param nominatedIds - Already-nominated games, excluded exactly as the pool
 * query excludes them: a game sitting in the nomination list must not be
 * re-offered as a suggestion on either row.
 */
export async function applyCohortRow(
  db: Db,
  lineupId: number,
  pool: CommonGroundGameDto[],
  nominatedIds: number[],
  ctx: ScoringContext | null,
  viewerId: number | null,
): Promise<CohortRowResult> {
  const sig = await loadCohortSignature(db, lineupId);
  if (!sig) return { cohortTiles: [], remainingPool: pool };

  const excluded = new Set(nominatedIds);
  const remembered = (await queryCohortMemory(db, sig, lineupId))
    .filter((row) => !excluded.has(Number(row.gameId)))
    // `queryCohortMemory` is uncapped — it returns one row per distinct game
    // the cohort has EVER resolved. That was fine when the consumer was a
    // standalone section; as the FIRST row of the hero, a group with 60 past
    // lineups would push all of Common Ground below the fold and append 60
    // extra tiles past the pool's own LIMIT. Rows arrive `lastResolvedAt DESC`,
    // so the cap reads as "the games you played together most recently".
    // Slicing here also bounds the IN (...) list `enrichRemembered` builds.
    .slice(0, COHORT_ROW_MAX);
  if (remembered.length === 0) return { cohortTiles: [], remainingPool: pool };

  const byGameId = await enrichRemembered(db, pool, remembered, ctx, viewerId);
  const cohortTiles: CommonGroundGameDto[] = [];
  const claimed = new Set<number>();
  for (const row of remembered) {
    const game = byGameId.get(Number(row.gameId));
    // A remembered game whose `games` row has since been deleted resolves to
    // nothing; the FK is ON DELETE CASCADE so this should be unreachable.
    if (!game) continue;
    cohortTiles.push(asCohortTile(game, row));
    claimed.add(game.gameId);
  }
  return {
    cohortTiles,
    remainingPool: pool.filter((g) => !claimed.has(g.gameId)),
  };
}

/**
 * Index the pool by game id, then top it up with any remembered game the pool
 * never returned — read through the SAME projection and mapped by the SAME
 * mapper, so a cohort-only tile is indistinguishable from a pool tile.
 */
async function enrichRemembered(
  db: Db,
  pool: CommonGroundGameDto[],
  remembered: CohortMemoryRow[],
  ctx: ScoringContext | null,
  viewerId: number | null,
): Promise<Map<number, CommonGroundGameDto>> {
  const byGameId = new Map(pool.map((g) => [g.gameId, g]));
  const missingIds = remembered
    .map((r) => Number(r.gameId))
    .filter((id) => !byGameId.has(id));
  for (const row of await queryCommonGroundByGameIds(db, missingIds)) {
    byGameId.set(row.gameId, mapCommonGroundRow(row, ctx, viewerId));
  }
  return byGameId;
}
