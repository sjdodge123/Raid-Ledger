/**
 * ROK-2040 (Codex P2) — finish a reschedule lock-in whose move committed but
 * whose follow-up work (`resetSignupConfirmations`, `notifyReschedule`,
 * activity log, re-read) threw. The claim is kept, so nothing else will ever
 * run this work: do it here, without moving the event again.
 */
import type { Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { RescheduleEventDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  notifyReschedule,
  resetSignupConfirmations,
} from '../../events/event-lifecycle.helpers';
import type { NotificationService } from '../../notifications/notification.service';
import type { Caller } from './standalone-poll-auth.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** What the recovery needs from the lock-in's deps. */
export interface RescheduleRecoveryDeps {
  db: Db;
  notificationService: NotificationService;
  logger: Pick<Logger, 'error'>;
}

/** The moved event: its row from before the move, and the move itself. */
export interface MovedReschedule {
  eventId: number;
  caller: Caller;
  before: typeof schema.events.$inferSelect;
  dto: RescheduleEventDto;
}

/**
 * Re-run the post-move side effects. Resetting confirmations is idempotent;
 * the notification is skipped when this move's rows already exist (one batch
 * INSERT, so all or none). A second failure is logged with the event id.
 */
export async function finishMovedReschedule(
  deps: RescheduleRecoveryDeps,
  moved: MovedReschedule,
): Promise<void> {
  const { db } = deps;
  const { eventId, caller, before, dto } = moved;
  try {
    await resetSignupConfirmations(db, eventId, caller.id);
    if (await rescheduleNotified(db, before, dto.startTime)) return;
    await notifyReschedule(
      db,
      deps.notificationService,
      eventId,
      caller.id,
      before,
      new Date(dto.startTime),
      dto,
    );
  } catch (err: unknown) {
    // Still a 200: the event moved and the poll is claimed; the event id in
    // the log is what triage needs to resend by hand.
    deps.logger.error(
      `Reschedule lock-in: event ${eventId} moved but its follow-up failed again: ${String(err)}`,
    );
  }
}

/**
 * True when this move's `event_rescheduled` rows exist: same event, same old
 * start and same new start. Matching the old start too keeps an earlier move
 * to the same slot (moved away, then back) from suppressing this one.
 */
async function rescheduleNotified(
  db: Db,
  before: MovedReschedule['before'],
  startTime: string,
): Promise<boolean> {
  const n = schema.notifications;
  const oldStartTime = before.duration[0].toISOString();
  const [row] = await db
    .select({ id: n.id })
    .from(n)
    .where(
      and(
        eq(n.type, 'event_rescheduled'),
        sql`${n.payload}->>'eventId' = ${String(before.id)}`,
        sql`${n.payload}->>'oldStartTime' = ${oldStartTime}`,
        sql`${n.payload}->>'newStartTime' = ${startTime}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
