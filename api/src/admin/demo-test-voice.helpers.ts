import type { ModuleRef } from '@nestjs/core';
import { and, eq, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import * as tables from '../drizzle/schema';
import {
  classifyEventSessions,
  autoPopulateAttendance,
} from '../discord-bot/services/voice-attendance-classify.helpers';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';

/** Parameters for injecting a synthetic voice session. */
export interface InjectVoiceSessionParams {
  eventId: number;
  discordUserId: string;
  userId: number;
  durationSec: number;
  firstJoinAt?: string;
  lastLeaveAt?: string;
}

/** Compute join/leave timestamps from the injection parameters. */
function resolveTimestamps(p: InjectVoiceSessionParams): {
  join: Date;
  leave: Date;
} {
  const leave = p.lastLeaveAt ? new Date(p.lastLeaveAt) : new Date();
  const join = p.firstJoinAt
    ? new Date(p.firstJoinAt)
    : new Date(leave.getTime() - p.durationSec * 1000);
  return { join, leave };
}

/**
 * Write a synthetic voice session row for (event, Discord user) (ROK-943 smoke
 * test). Upserts: the minute classify cron can reach a just-ended test event
 * between its signups and this call and write a 0-second `no_show` row for
 * every signup (session row AND signup attendance); an insert-or-skip would
 * then keep that row and the smoke would classify only no-shows. The injected
 * session replaces it, classification cleared, and the voice-sourced attendance
 * is reset, so trigger-classify sees and records the session the test asked for.
 */
export async function injectVoiceSessionForTest(
  db: PostgresJsDatabase<typeof schema>,
  p: InjectVoiceSessionParams,
): Promise<void> {
  const { join, leave } = resolveTimestamps(p);
  const session = {
    userId: p.userId,
    discordUsername: 'smoke-test',
    firstJoinAt: join,
    lastLeaveAt: leave,
    totalDurationSec: p.durationSec,
    segments: [
      {
        joinAt: join.toISOString(),
        leaveAt: leave.toISOString(),
        durationSec: p.durationSec,
      },
    ],
    classification: null,
  };
  await db
    .insert(tables.eventVoiceSessions)
    .values({ eventId: p.eventId, discordUserId: p.discordUserId, ...session })
    .onConflictDoUpdate({
      target: [
        tables.eventVoiceSessions.eventId,
        tables.eventVoiceSessions.discordUserId,
      ],
      set: session,
    });
  await clearVoiceAttendance(db, p);
}

/**
 * Reset the attendance a cron-written no-show already stamped on this
 * signup. Only voice-sourced rows: `autoPopulateAttendance` fills NULL
 * attendance only, so without this the re-classify after an inject leaves
 * `no_show` beside an attended session. Organizer-set attendance is kept.
 */
async function clearVoiceAttendance(
  db: PostgresJsDatabase<typeof schema>,
  p: InjectVoiceSessionParams,
): Promise<void> {
  const signups = tables.eventSignups;
  await db
    .update(signups)
    .set({
      attendanceStatus: null,
      attendanceSource: null,
      attendanceRecordedAt: null,
    })
    .where(
      and(
        eq(signups.eventId, p.eventId),
        eq(signups.attendanceSource, 'voice'),
        or(
          eq(signups.discordUserId, p.discordUserId),
          eq(signups.userId, p.userId),
        ),
      ),
    );
}

/** Flush in-memory voice attendance sessions to the DB (ROK-1072 extraction). */
export async function flushVoiceSessionsForTest(
  moduleRef: ModuleRef,
): Promise<{ success: boolean }> {
  const svc = moduleRef.get(VoiceAttendanceService, { strict: false });
  await svc.flushToDb();
  return { success: true };
}

/** Trigger voice classification + attendance auto-population (ROK-943). */
export async function triggerClassifyForTest(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  const logger = { log: () => {}, warn: () => {} };
  const defaultGraceMs = 5 * 60 * 1000;
  await classifyEventSessions(db, eventId, undefined, defaultGraceMs, logger);
  await autoPopulateAttendance(db, eventId, logger);
}
