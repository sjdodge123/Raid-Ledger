import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import type * as schema from '../drizzle/schema';
import * as tables from '../drizzle/schema';
import { ScheduledEventService } from '../discord-bot/services/scheduled-event.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

/** Reconciliation cron job name used for pause lookup. */
const RECONCILIATION_JOB_NAME = 'ScheduledEventReconciliation_reconcileMissing';

/** Enable Discord scheduled event creation (ROK-969). */
export function enableScheduledEventsForTest(moduleRef: ModuleRef): {
  success: boolean;
} {
  const svc = moduleRef.get(ScheduledEventService, { strict: false });
  svc.setScheduledEventsEnabled(true);
  return { success: true };
}

/** Disable Discord scheduled event creation (ROK-969). */
export function disableScheduledEventsForTest(moduleRef: ModuleRef): {
  success: boolean;
} {
  const svc = moduleRef.get(ScheduledEventService, { strict: false });
  svc.setScheduledEventsEnabled(false);
  return { success: true };
}

/** Delete all Discord scheduled events in the guild (ROK-969). */
export async function cleanupScheduledEventsForTest(
  moduleRef: ModuleRef,
): Promise<{
  success: boolean;
  deleted: number;
  failed: number;
  total: number;
}> {
  const client = moduleRef.get(DiscordBotClientService, { strict: false });
  const guild = client.getGuild();
  if (!guild) return { success: true, deleted: 0, failed: 0, total: 0 };
  const events = await guild.scheduledEvents.fetch();
  const results = await Promise.allSettled(
    [...events.values()].map((se: { delete(): Promise<unknown> }) =>
      se.delete(),
    ),
  );
  const deleted = results.filter((r) => r.status === 'fulfilled').length;
  return {
    success: true,
    deleted,
    failed: results.length - deleted,
    total: events.size,
  };
}

/** Pause the reconciliation cron to prevent API queue flooding (ROK-969). */
export async function pauseReconciliationForTest(
  moduleRef: ModuleRef,
): Promise<{ success: boolean }> {
  const cron = moduleRef.get(CronJobService, { strict: false });
  const jobs = await cron.listJobs();
  const job = jobs.find(
    (j: { name: string }) => j.name === RECONCILIATION_JOB_NAME,
  );
  if (job && !job.paused) await cron.pauseJob(job.id);
  return { success: true };
}

/** Force-set event times bypassing Zod validation (ROK-969). */
export async function setEventTimesForTest(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  startTime: string,
  endTime: string,
): Promise<{ success: boolean }> {
  await db
    .update(tables.events)
    .set({
      duration: sql`tsrange(${startTime}::timestamp, ${endTime}::timestamp)`,
    })
    .where(eq(tables.events.id, eventId));
  return { success: true };
}
