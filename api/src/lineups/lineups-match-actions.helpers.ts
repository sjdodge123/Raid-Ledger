/**
 * Thin wrappers around match actions (bandwagon/advance) + scheduling hook.
 * Extracted from lineups.service.ts in ROK-1063 to keep the service under
 * the 300-line ESLint limit.
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { BandwagonJoinResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LineupNotificationService } from './lineup-notification.service';
import {
  executeBandwagonJoin,
  advanceMatch as advanceMatchHelper,
} from './lineups-bandwagon.helpers';
import { fireSchedulingOpen } from './lineups-notify-hooks.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export async function runBandwagonJoin(
  db: Db,
  notifications: LineupNotificationService,
  logger: Logger,
  lineupId: number,
  matchId: number,
  userId: number,
): Promise<BandwagonJoinResponseDto> {
  const result = await executeBandwagonJoin(db, lineupId, matchId, userId);
  if (result.promoted) fireSchedulingOpen(notifications, logger, db, matchId);
  return result;
}

export async function runAdvanceMatch(
  db: Db,
  notifications: LineupNotificationService,
  logger: Logger,
  lineupId: number,
  matchId: number,
): Promise<{ promoted: boolean }> {
  const result = await advanceMatchHelper(db, lineupId, matchId);
  if (result.promoted) fireSchedulingOpen(notifications, logger, db, matchId);
  return result;
}
