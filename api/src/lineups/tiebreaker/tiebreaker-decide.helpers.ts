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
  const update: Partial<typeof schema.communityLineups.$inferInsert> = {
    status: 'decided',
    updatedAt: new Date(),
  };
  if (decidedGameId) update.decidedGameId = decidedGameId;
  await deps.db
    .update(schema.communityLineups)
    .set(update)
    .where(eq(schema.communityLineups.id, lineupId));
  // Run matching algorithm so decided view has match groups.
  await runMatchingAlgorithm(deps.db, lineupId, deps.logger, deps.events);
}
