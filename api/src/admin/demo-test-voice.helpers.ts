import type { ModuleRef } from '@nestjs/core';
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

/** Insert a synthetic voice session row into the DB (ROK-943 smoke test). */
export async function injectVoiceSessionForTest(
  db: PostgresJsDatabase<typeof schema>,
  p: InjectVoiceSessionParams,
): Promise<void> {
  const { join, leave } = resolveTimestamps(p);
  await db
    .insert(tables.eventVoiceSessions)
    .values({
      eventId: p.eventId,
      userId: p.userId,
      discordUserId: p.discordUserId,
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
    })
    .onConflictDoNothing();
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
