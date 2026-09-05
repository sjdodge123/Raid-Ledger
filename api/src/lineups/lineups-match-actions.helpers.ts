/**
 * Thin wrappers around match actions (bandwagon/advance) + scheduling hook.
 * Extracted from lineups.service.ts in ROK-1063 to keep the service under
 * the 300-line ESLint limit.
 */
import { NotFoundException, type Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { BandwagonJoinResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LineupNotificationService } from './lineup-notification.service';
import {
  executeBandwagonJoin,
  advanceMatch as advanceMatchHelper,
} from './lineups-bandwagon.helpers';
import { fireSchedulingOpen } from './lineups-notify-hooks.helpers';
import { fireMatchEnteredScheduling } from './lineups-scheduling-hook.helpers';
import { findLineupById } from './lineups-query.helpers';
import { assertUserCanParticipate } from './lineups-eligibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Collaborators the match actions need (ROK-1473).
 *
 * Structurally satisfied by `LineupsService.autoAdvanceDeps()`, so the
 * service hands the same bundle to the transition and the match actions.
 */
export interface MatchActionDeps {
  db: Db;
  lineupNotifications: LineupNotificationService;
  logger: Logger;
  /** Carries the entered-scheduling hook (the Discord poll card). */
  eventEmitter: EventEmitter2;
}

/**
 * Run a bandwagon-join (ROK-937, ROK-1065).
 * Loads the lineup and enforces the private-lineup eligibility gate before
 * accepting the join. A non-invitee (no admin/operator role, not the
 * creator, not in the invitee list) cannot bandwagon onto a private lineup.
 *
 * ROK-1473: a join that trips the threshold promotes the match to
 * `scheduling`, so it also fires the entered-scheduling hook (the Discord
 * poll card) alongside the existing scheduling-open notification.
 *
 * @param deps - Db, notification service, logger and the event bus.
 */
export async function runBandwagonJoin(
  deps: MatchActionDeps,
  lineupId: number,
  matchId: number,
  userId: number,
  callerRole?: string,
): Promise<BandwagonJoinResponseDto> {
  const { db, lineupNotifications: notifications, logger, eventEmitter } = deps;
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  await assertUserCanParticipate(db, lineup, { id: userId, role: callerRole });
  const result = await executeBandwagonJoin(db, lineupId, matchId, userId);
  if (result.promoted) {
    fireSchedulingOpen(notifications, logger, db, matchId);
    fireMatchEnteredScheduling(eventEmitter, matchId);
  }
  return result;
}

/**
 * Promote a suggested match to scheduling (operator action, ROK-937).
 *
 * ROK-1473: mirrors the bandwagon path — a promotion announces the phase so
 * the poll card is posted for an operator-driven advance too.
 *
 * @param deps - Db, notification service, logger and the event bus.
 */
export async function runAdvanceMatch(
  deps: MatchActionDeps,
  lineupId: number,
  matchId: number,
): Promise<{ promoted: boolean }> {
  const { db, lineupNotifications: notifications, logger, eventEmitter } = deps;
  const result = await advanceMatchHelper(db, lineupId, matchId);
  if (result.promoted) {
    fireSchedulingOpen(notifications, logger, db, matchId);
    fireMatchEnteredScheduling(eventEmitter, matchId);
  }
  return result;
}
