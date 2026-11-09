/**
 * Tiebreaker → decided transition (extracted in ROK-1473).
 *
 * `TiebreakerService` sat exactly on the 300-line ESLint cap, so the write +
 * matching pass moved out here when the matching call gained the
 * entered-scheduling hook. Behaviour is unchanged: flip the lineup row, then
 * run matching so the decided view has match groups — and, since ROK-1473,
 * so every match that lands in `scheduling` gets its Discord poll card.
 */
import type { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { runMatchingAlgorithm } from '../lineups-lifecycle.helpers';
import { writeDecidedCohortMemory } from '../cohort-memory-write.helpers';
import {
  buildMatchesForLineup,
  type MatchingPassResult,
} from '../lineups-matching.helpers';
import {
  fireMatchEnteredScheduling,
  fireOrphanedPollCards,
} from '../lineups-scheduling-hook.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Collaborators the tiebreaker decide path needs. */
export interface TiebreakerDecideDeps {
  db: Db;
  logger: Logger;
  /** Carries the entered-scheduling hook into the matching pass. */
  events: EventEmitter2;
}

/**
 * Move a lineup to `decided` after its tiebreaker resolved, then rebuild the
 * match groups.
 *
 * @param deps - Drizzle handle, logger and the application event bus.
 * @param lineupId - Lineup being decided.
 * @param decidedGameId - Winning game, when the tiebreaker produced one.
 */
export async function decideLineupFromTiebreaker(
  deps: TiebreakerDecideDeps,
  lineupId: number,
  decidedGameId?: number,
): Promise<void> {
  await flipLineupToDecided(deps.db, lineupId, decidedGameId);
  // Run matching algorithm so decided view has match groups.
  await runMatchingAlgorithm(deps.db, lineupId, deps.logger, deps.events);
  // ROK-1309: this path bypasses `runStatusTransition` entirely, so it needs
  // its own cohort-memory write — after matching, for the same reason.
  await writeDecidedCohortMemory(deps.db, lineupId, deps.logger);
}

/**
 * ROK-2098: the flip + matching pass of a decide, on `tx` (the finalize
 * path's round-advance-lock transaction). Pure DB work: it fires no events
 * and swallows no error — a failed statement poisons the transaction, so it
 * must reach the caller and roll the whole finalize back. The caller hands
 * the result to `announceLineupDecided` AFTER the transaction commits.
 */
export async function decideLineupInTx(
  tx: Db,
  lineupId: number,
  decidedGameId: number,
): Promise<MatchingPassResult> {
  await flipLineupToDecided(tx, lineupId, decidedGameId);
  // `?? EMPTY_PASS` — several specs mock the matching helper bare.
  return (await buildMatchesForLineup(tx, lineupId)) ?? EMPTY_PASS;
}

/**
 * ROK-2098: after-commit side effects of `decideLineupInTx` — the poll-card
 * events (their listeners read the committed match rows on other
 * connections) and the decided cohort memory (best-effort, swallows errors,
 * so never on a transaction handle).
 */
export async function announceLineupDecided(
  deps: TiebreakerDecideDeps,
  lineupId: number,
  pass: MatchingPassResult,
): Promise<void> {
  fireOrphanedPollCards(deps.events, pass.orphanedCards);
  fireMatchEnteredScheduling(deps.events, pass.schedulingMatchIds);
  await writeDecidedCohortMemory(deps.db, lineupId, deps.logger);
}

const EMPTY_PASS: MatchingPassResult = {
  schedulingMatchIds: [],
  orphanedCards: [],
};

/** Flip the lineup row to `decided`, stamping the winner when there is one. */
async function flipLineupToDecided(
  db: Db,
  lineupId: number,
  decidedGameId?: number,
): Promise<void> {
  const update: Partial<typeof schema.communityLineups.$inferInsert> = {
    status: 'decided',
    updatedAt: new Date(),
  };
  if (decidedGameId) update.decidedGameId = decidedGameId;
  await db
    .update(schema.communityLineups)
    .set(update)
    .where(eq(schema.communityLineups.id, lineupId));
}
