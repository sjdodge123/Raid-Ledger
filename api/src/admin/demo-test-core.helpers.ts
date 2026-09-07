/**
 * DEMO_MODE-only helpers for core smoke-test plumbing: Discord linking,
 * notification prefs/queries, and BullMQ queue flushing.
 * Extracted from demo-test.service.ts (ROK-1072) to keep the service a thin
 * facade. Pure functions over passed-in moduleRef/db handles.
 */
import { ConflictException, Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { NOTIFICATION_TYPES } from '../drizzle/schema/notification-preferences';
import type { ChannelPrefs } from '../drizzle/schema/notification-preferences';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { QueueHealthService } from '../queue/queue-health.service';
import type {
  FailedJobSummary,
  QueueHealthStatus,
} from '../queue/queue-health.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Link a Discord ID to a user (smoke tests). */
export async function linkDiscordForTest(
  db: Db,
  userId: number,
  discordId: string,
  username: string,
): Promise<typeof schema.users.$inferSelect | undefined> {
  // Clear the Discord ID from any other user first (avoids unique constraint
  // when multiple CI smoke categories re-run setup with different dmRecipient)
  await db
    .update(schema.users)
    .set({ discordId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.users.discordId, discordId),
        sql`${schema.users.id} != ${userId}`,
      ),
    );
  const [updated] = await db
    .update(schema.users)
    .set({ discordId, username, updatedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning();
  return updated;
}

/** Build a ChannelPrefs object with all channels enabled for all types. */
export function buildAllChannelsEnabled(): ChannelPrefs {
  const prefs = {} as Record<string, Record<string, boolean>>;
  for (const type of NOTIFICATION_TYPES) {
    prefs[type] = { inApp: true, push: true, discord: true };
  }
  return prefs as ChannelPrefs;
}

/** Enable Discord DM notifications for a user. */
export async function enableDiscordNotificationsForTest(
  db: Db,
  userId: number,
): Promise<void> {
  const prefs = buildAllChannelsEnabled();
  await db
    .insert(schema.userNotificationPreferences)
    .values({ userId, channelPrefs: prefs })
    .onConflictDoUpdate({
      target: schema.userNotificationPreferences.userId,
      set: { channelPrefs: prefs },
    });
}

/** Query a user's notifications (smoke tests). */
export async function getNotificationsForTest(
  db: Db,
  userId: number,
  type?: string,
  limit = 20,
): Promise<(typeof schema.notifications.$inferSelect)[]> {
  const conditions = [eq(schema.notifications.userId, userId)];
  if (type) {
    conditions.push(sql`${schema.notifications.type} = ${type}`);
  }
  return db
    .select()
    .from(schema.notifications)
    .where(and(...conditions))
    .orderBy(sql`${schema.notifications.createdAt} DESC`)
    .limit(limit);
}

/** Clear game_time_confirmed_at for a user (ROK-999). */
export async function clearGameTimeConfirmationForTest(
  db: Db,
  userId: number,
): Promise<void> {
  await db
    .update(schema.users)
    .set({ gameTimeConfirmedAt: null })
    .where(eq(schema.users.id, userId));
}

/** Flush the roster notification buffer and return pending count. */
export async function flushNotificationBufferForTest(
  moduleRef: ModuleRef,
): Promise<number> {
  const buf = moduleRef.get(RosterNotificationBufferService, {
    strict: false,
  });
  const count = buf.pendingCount;
  await buf.flushAll();
  return count;
}

/** Drain the embed sync BullMQ queue. */
export async function flushEmbedQueueForTest(
  moduleRef: ModuleRef,
): Promise<{ success: boolean }> {
  const qhs = moduleRef.get(QueueHealthService, { strict: false });
  await qhs.drainAll();
  return { success: true };
}

const awaitProcessingLogger = new Logger('DemoTestCore');

/** Structured body for a drain that never completed (ROK-1511). */
export interface AwaitProcessingFailure {
  error: 'await-processing-failed';
  message: string;
  timeoutMs: number;
  busyQueues: Pick<
    QueueHealthStatus,
    'name' | 'waiting' | 'active' | 'delayed' | 'failed'
  >[];
  failedJobs: FailedJobSummary[];
}

/** Shape the drain-timeout diagnostics; idle queues are dropped as noise. */
export function buildAwaitProcessingFailure(
  timeoutMs: number,
  err: unknown,
  statuses: QueueHealthStatus[],
  failedJobs: FailedJobSummary[],
): AwaitProcessingFailure {
  return {
    error: 'await-processing-failed',
    message: err instanceof Error ? err.message : String(err),
    timeoutMs,
    busyQueues: statuses
      .filter((s) => s.waiting > 0 || s.active > 0 || s.delayed > 0)
      .map(({ name, waiting, active, delayed, failed }) => ({
        name,
        waiting,
        active,
        delayed,
        failed,
      })),
    failedJobs,
  };
}

/** Best-effort diagnostics — never mask the original drain timeout. */
async function collectDrainDiagnostics(
  qhs: QueueHealthService,
): Promise<[QueueHealthStatus[], FailedJobSummary[]]> {
  try {
    return await Promise.all([qhs.getHealthStatus(), qhs.getFailedJobs()]);
  } catch {
    return [[], []];
  }
}

/**
 * Wait for all BullMQ queues to drain.
 *
 * ROK-1511: a stuck or permanently failing job used to surface as a bare
 * `500 Internal server error` in every later smoke test. Report 409 with a
 * body naming the busy queues and the failing job (409, not 5xx, so an
 * expected test-harness timeout does not spam Sentry — see
 * SentryExceptionFilter, which captures only status >= 500).
 */
export async function awaitProcessingForTest(
  moduleRef: ModuleRef,
  timeoutMs = 30_000,
): Promise<void> {
  const qhs = moduleRef.get(QueueHealthService, { strict: false });
  try {
    await qhs.awaitDrained(timeoutMs);
  } catch (err) {
    const [statuses, failedJobs] = await collectDrainDiagnostics(qhs);
    const body = buildAwaitProcessingFailure(
      timeoutMs,
      err,
      statuses,
      failedJobs,
    );
    awaitProcessingLogger.error(
      `await-processing failed after ${timeoutMs}ms — busy=${JSON.stringify(
        body.busyQueues,
      )} failed=${failedJobs
        .map((j) => `${j.queue}#${j.jobId} ${j.name}: ${j.error}`)
        .join(' | ')}`,
    );
    throw new ConflictException(body);
  }
}
