/**
 * Cohort-memory write triggers (ROK-1309).
 *
 * Two entry points, both additive, both idempotent on replay:
 *
 *   `writeDecidedCohortMemory`      — voting -> decided. One `decided` row for
 *                                     `communityLineups.decidedGameId` plus one
 *                                     `match` row per match-tier game.
 *   `writeTiebreakerCohortMemory`   — tiebreaker resolved. One `veto_won` row
 *                                     for the survivor, one `veto_lost` row per
 *                                     game vetoed out.
 *
 * ## Invariants
 *
 * - **Idempotency is `ON CONFLICT DO NOTHING`, never catch-and-retry.** Under
 *   postgres.js a failed statement poisons the whole transaction, savepoints
 *   included (ROK-1437), so the only safe shape is a statement that cannot
 *   violate. `uq_cl_cohort_memory_row` is the natural key.
 * - **Call AFTER `runMatchingAlgorithm`.** The `match`-tier rows do not exist
 *   until it has run. `runMatchingAlgorithm` swallows its own errors
 *   (`lineups-lifecycle.helpers.ts`), so zero match rows is a legitimate
 *   outcome and writes only the `decided` row rather than throwing.
 * - **Never fail the transition.** Cohort memory is additive; a write failure
 *   is logged and dropped, mirroring the matching pass's own precedent.
 * - **Empty cohort writes nothing.** A lineup with zero nominators AND zero
 *   voters has no signature at all.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CohortMemoryResolution } from '../drizzle/schema/community-lineup-cohort-memory';
import {
  loadCohortSignature,
  type CohortSignature,
} from './cohort-memory-signature.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Fallback sink so a swallowed write failure is never invisible. Callers that
 * have a request-scoped logger pass it; `resolveTiebreaker` has none.
 */
const fallbackLogger = new Logger('CohortMemory');

/** One (game, outcome) pair to remember against a cohort. */
interface CohortOutcome {
  gameId: number;
  resolution: CohortMemoryResolution;
}

/** Insert the outcomes for one lineup's cohort, ignoring replays. */
async function persistOutcomes(
  db: Db,
  lineupId: number,
  sig: CohortSignature,
  outcomes: CohortOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  await db
    .insert(schema.communityLineupCohortMemory)
    .values(
      outcomes.map((outcome) => ({
        participantIds: sig.participantIds,
        participantHash: sig.participantHash,
        cohortSize: sig.cohortSize,
        sourceLineupId: lineupId,
        gameId: outcome.gameId,
        resolution: outcome.resolution,
      })),
    )
    .onConflictDoNothing();
}

/** Resolve the signature and persist, or no-op on an empty cohort. */
async function remember(
  db: Db,
  lineupId: number,
  build: () => Promise<CohortOutcome[]>,
  logger?: Logger,
): Promise<void> {
  try {
    const sig = await loadCohortSignature(db, lineupId);
    if (!sig) return;
    await persistOutcomes(db, lineupId, sig, await build());
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    (logger ?? fallbackLogger).error(
      `Cohort memory write failed for lineup ${lineupId}: ${detail}`,
    );
  }
}

/**
 * Record the outcome of a `voting -> decided` transition.
 *
 * MUST be called after `runMatchingAlgorithm` — see the header.
 *
 * @param db - Drizzle handle (not a transaction; side effects fire after commit).
 * @param lineupId - The lineup that just decided.
 * @param logger - Optional; a write failure is logged rather than thrown.
 */
export async function writeDecidedCohortMemory(
  db: Db,
  lineupId: number,
  logger?: Logger,
): Promise<void> {
  await remember(
    db,
    lineupId,
    () => buildDecidedOutcomes(db, lineupId),
    logger,
  );
}

async function buildDecidedOutcomes(
  db: Db,
  lineupId: number,
): Promise<CohortOutcome[]> {
  const [lineup] = await db
    .select({ decidedGameId: schema.communityLineups.decidedGameId })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  const matches = await db
    .select({ gameId: schema.communityLineupMatches.gameId })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.lineupId, lineupId));

  const outcomes: CohortOutcome[] = matches.map((m) => ({
    gameId: m.gameId,
    resolution: 'match' as const,
  }));
  if (lineup?.decidedGameId) {
    outcomes.push({ gameId: lineup.decidedGameId, resolution: 'decided' });
  }
  return outcomes;
}

/**
 * Record the outcome of a resolved tiebreaker: the survivor plus every game
 * vetoed out of `communityLineupTiebreakers.tiedGameIds`.
 *
 * `tiedGameIds` is jsonb but holds an ARRAY, so element order round-trips
 * intact (never assert key order on a jsonb OBJECT — ROK-1506).
 *
 * @param db - Drizzle handle.
 * @param lineupId - Lineup the tiebreaker belongs to.
 * @param tiebreakerId - The tiebreaker that just resolved.
 * @param winnerGameId - The surviving game.
 * @param logger - Optional; a write failure is logged rather than thrown.
 */
export async function writeTiebreakerCohortMemory(
  db: Db,
  lineupId: number,
  tiebreakerId: number,
  winnerGameId: number,
  logger?: Logger,
): Promise<void> {
  await remember(
    db,
    lineupId,
    () => buildTiebreakerOutcomes(db, tiebreakerId, winnerGameId),
    logger,
  );
}

async function buildTiebreakerOutcomes(
  db: Db,
  tiebreakerId: number,
  winnerGameId: number,
): Promise<CohortOutcome[]> {
  const [tb] = await db
    .select({ tiedGameIds: schema.communityLineupTiebreakers.tiedGameIds })
    .from(schema.communityLineupTiebreakers)
    .where(eq(schema.communityLineupTiebreakers.id, tiebreakerId))
    .limit(1);
  const tied = tb?.tiedGameIds ?? [];
  const losers = [...new Set(tied)].filter((id) => id !== winnerGameId);
  return [
    { gameId: winnerGameId, resolution: 'veto_won' as const },
    ...losers.map((gameId) => ({
      gameId,
      resolution: 'veto_lost' as const,
    })),
  ];
}
