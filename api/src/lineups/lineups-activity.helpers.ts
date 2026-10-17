import type {
  UpdateLineupStatusDto,
  NominateGameDto,
} from '@raid-ledger/contract';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { findGameName } from './lineups-query.helpers';

const DEADLINE_EXTENDED_ACTION = 'lineup_deadline_extended';

/** Log activity for a status transition. */
export async function logTransition(
  db: PostgresJsDatabase<typeof schema>,
  activityLog: ActivityLogService,
  id: number,
  dto: UpdateLineupStatusDto,
): Promise<void> {
  if (dto.status === 'voting') {
    await activityLog.log('lineup', id, 'voting_started', null, {
      votingDeadline: dto.votingDeadline ?? null,
    });
  } else if (dto.status === 'decided' && dto.decidedGameId) {
    const [game] = await findGameName(db, dto.decidedGameId);
    await activityLog.log('lineup', id, 'lineup_decided', null, {
      gameId: dto.decidedGameId,
      gameName: game?.name ?? 'Unknown',
    });
  }
}

/** Log a nomination event. */
export async function logNomination(
  db: PostgresJsDatabase<typeof schema>,
  activityLog: ActivityLogService,
  lineupId: number,
  dto: NominateGameDto,
  userId: number,
): Promise<void> {
  const [game] = await findGameName(db, dto.gameId);
  await activityLog.log('lineup', lineupId, 'game_nominated', userId, {
    gameId: dto.gameId,
    gameName: game?.name ?? 'Unknown',
    note: dto.note ?? null,
  });
}

/**
 * Log an abort of a lineup (ROK-1062). ROK-1443: `actorId` is null when the
 * system aborted it (building deadline with nobody nominating) — an invented
 * actor would be a lie the timeline believes (see `TieExpiryService`).
 */
export async function logAborted(
  activityLog: ActivityLogService,
  lineupId: number,
  actorId: number | null,
  reason: string | null,
): Promise<void> {
  await activityLog.log('lineup', lineupId, 'lineup_aborted', actorId, {
    reason,
  });
}

/**
 * ROK-1253: Log an operator-driven backward revert that arms the
 * auto-advance pause. Captures the from/to statuses so the timeline reads
 * naturally ("voting → building").
 */
export async function logAutoAdvancePaused(
  activityLog: ActivityLogService,
  lineupId: number,
  actorId: number,
  fromStatus: string,
  toStatus: string,
): Promise<void> {
  await activityLog.log(
    'lineup',
    lineupId,
    'lineup_auto_advance_paused',
    actorId,
    { fromStatus, toStatus },
  );
}

/**
 * ROK-1443: the building deadline passed with fewer than the floor of
 * nominations and the window was extended once. No actor — the clock did it.
 */
export async function logDeadlineExtended(
  activityLog: ActivityLogService,
  lineupId: number,
  meta: {
    previousDeadline: string | null;
    newDeadline: string;
    nominationCount: number;
  },
): Promise<void> {
  await activityLog.log(
    'lineup',
    lineupId,
    DEADLINE_EXTENDED_ACTION,
    null,
    meta,
  );
}

/**
 * ROK-1443 (D5): how many times this lineup's building deadline was extended.
 * A direct `count(*)` rather than `getTimeline` (which loads every row plus a
 * users join to answer a boolean). Activity rows survive a `voting → building`
 * revert, so the count is the extension memory — no schema column needed.
 */
export async function countDeadlineExtensions(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'lineup'),
        eq(schema.activityLog.entityId, lineupId),
        eq(schema.activityLog.action, DEADLINE_EXTENDED_ACTION),
      ),
    );
  return row?.count ?? 0;
}
