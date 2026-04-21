/**
 * Thin wrappers around match actions (bandwagon/advance) + scheduling hook.
 * Extracted from lineups.service.ts in ROK-1063 to keep the service under
 * the 300-line ESLint limit.
 */
import { NotFoundException, type Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { BandwagonJoinResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LineupNotificationService } from './lineup-notification.service';
import {
  executeBandwagonJoin,
  advanceMatch as advanceMatchHelper,
} from './lineups-bandwagon.helpers';
import { fireSchedulingOpen } from './lineups-notify-hooks.helpers';
import { findLineupById } from './lineups-query.helpers';
import { assertUserCanParticipate } from './lineups-eligibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Run a bandwagon-join (ROK-937, ROK-1065).
 * Loads the lineup and enforces the private-lineup eligibility gate before
 * accepting the join. A non-invitee (no admin/operator role, not the
 * creator, not in the invitee list) cannot bandwagon onto a private lineup.
 */
export async function runBandwagonJoin(
  db: Db,
  notifications: LineupNotificationService,
  logger: Logger,
  lineupId: number,
  matchId: number,
  userId: number,
  callerRole?: string,
): Promise<BandwagonJoinResponseDto> {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  await assertUserCanParticipate(db, lineup, { id: userId, role: callerRole });
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
