import type {
  UpdateLineupStatusDto,
  NominateGameDto,
} from '@raid-ledger/contract';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { findGameName } from './lineups-query.helpers';

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
