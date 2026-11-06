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
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { runMatchingAlgorithm } from '../lineups-lifecycle.helpers';
import { writeDecidedCohortMemory } from '../cohort-memory-write.helpers';

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
 * The flip is conditional (`status <> 'decided'`) and is the once-only guard
 * for the transition: when a force-resolve and the final vote both get here,
 * the second UPDATE re-evaluates its WHERE after the first commits and
 * matches nothing, so matching (which wipes/rebuilds matches and re-fires the
 * entered-scheduling hook → Discord poll cards) runs once.
 *
 * Known gap: if matching or the cohort-memory write throws AFTER the flip
 * committed, a retry finds the lineup already `decided` and does not re-run
 * them (TECH-DEBT-BACKLOG batch O).
 *
 * @param deps - Drizzle handle, logger and the application event bus.
 * @param lineupId - Lineup being decided.
 * @param decidedGameId - Winning game, when the tiebreaker produced one.
 * @returns `true` when this call flipped the lineup (and ran matching).
 */
export async function decideLineupFromTiebreaker(
  deps: TiebreakerDecideDeps,
  lineupId: number,
  decidedGameId?: number,
): Promise<boolean> {
  const L = schema.communityLineups;
  const update: Partial<typeof schema.communityLineups.$inferInsert> = {
    status: 'decided',
    updatedAt: new Date(),
  };
  if (decidedGameId) update.decidedGameId = decidedGameId;
  const flipped = await deps.db
    .update(L)
    .set(update)
    .where(and(eq(L.id, lineupId), ne(L.status, 'decided')))
    .returning({ id: L.id });
  if (flipped.length === 0) return false;
  // Run matching algorithm so decided view has match groups.
  await runMatchingAlgorithm(deps.db, lineupId, deps.logger, deps.events);
  // ROK-1309: this path bypasses `runStatusTransition` entirely, so it needs
  // its own cohort-memory write — after matching, for the same reason.
  await writeDecidedCohortMemory(deps.db, lineupId, deps.logger);
  return true;
}
