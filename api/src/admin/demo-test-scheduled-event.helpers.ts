import type { ModuleRef } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import type * as schema from '../drizzle/schema';
import * as tables from '../drizzle/schema';
import { ScheduledEventService } from '../discord-bot/services/scheduled-event.service';
import { ScheduledEventReconciliationService } from '../discord-bot/services/scheduled-event.reconciliation';
import { PostEventFollowupService } from '../notifications/post-event-followup.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

/** Reconciliation cron job name used for pause lookup. */
const RECONCILIATION_JOB_NAME = 'ScheduledEventReconciliation_reconcileMissing';

/** Logger for the scheduled-event test hooks (ROK-1623). */
const seCleanupLogger = new Logger('DemoTestScheduledEvent');

/** Result of cleanupScheduledEventsForTest. */
export interface CleanupSEResult {
  success: boolean;
  deleted: number;
  failed: number;
  /** Fetched events left alone because this bot did not create them (ROK-1623). */
  skipped: number;
  total: number;
  /** Set when the cleanup deleted nothing on purpose — never a silent no-op. */
  reason?: string;
}

/** The slice of a discord.js GuildScheduledEvent this cleanup needs. */
interface DeletableScheduledEvent {
  id: string;
  creatorId: string | null;
  delete(): Promise<unknown>;
}

/** Trigger the scheduled event completion cron once (ROK-944). */
export async function triggerScheduledEventCompletionForTest(
  moduleRef: ModuleRef,
): Promise<{ success: boolean }> {
  const svc = moduleRef.get(ScheduledEventService, { strict: false });
  await svc.completeExpiredEvents();
  return { success: true };
}

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

/** A cleanup that deleted nothing, naming why (never a silent no-op). */
function noOpCleanup(reason: string, success = true): CleanupSEResult {
  return { success, deleted: 0, failed: 0, skipped: 0, total: 0, reason };
}

/**
 * Delete the Discord scheduled events THIS bot created (ROK-969, narrowed by
 * ROK-1623).
 *
 * GitHub CI and every fleet env share one Discord guild, so the original
 * unfiltered `fetch()`-then-delete-everything wiped a sibling env's scheduled
 * events mid-test — a red run with nothing in the victim's own logs. Ownership
 * comes from `GuildScheduledEvent.creatorId` (populated by discord.js from the
 * REST `creator_id`, present on every event created after 2021-10-25) matched
 * against the user this process is logged in as. Anything else — a foreign
 * bot's event, or an event with no creator — is SKIPPED and counted, never
 * deleted.
 */
export async function cleanupScheduledEventsForTest(
  moduleRef: ModuleRef,
): Promise<CleanupSEResult> {
  const client = moduleRef.get(DiscordBotClientService, { strict: false });
  const guild = client.getGuild();
  if (!guild) return noOpCleanup('no-guild');
  const botUserId = client.getBotUser()?.id ?? null;
  if (!botUserId) {
    seCleanupLogger.error(
      "ROK-1623: cannot resolve this bot's Discord user id — refusing to " +
        'delete any scheduled events (the guild is shared with other envs).',
    );
    return noOpCleanup('bot-identity-unresolved', false);
  }
  const events = await guild.scheduledEvents.fetch();
  const all = [...events.values()] as unknown as DeletableScheduledEvent[];
  return deleteOwnedScheduledEvents(all, botUserId);
}

/** Delete only the events created by `botUserId`; report the skipped rest. */
async function deleteOwnedScheduledEvents(
  all: DeletableScheduledEvent[],
  botUserId: string,
): Promise<CleanupSEResult> {
  const owned = all.filter((se) => se.creatorId === botUserId);
  const skipped = all.length - owned.length;
  if (skipped > 0) {
    seCleanupLogger.log(
      `ROK-1623: skipped ${skipped}/${all.length} scheduled event(s) not ` +
        `created by bot ${botUserId} — shared guild, another env (or a human) ` +
        'owns them. Skipped ids: ' +
        all
          .filter((se) => se.creatorId !== botUserId)
          .map((se) => `${se.id}(creator=${se.creatorId ?? 'unknown'})`)
          .join(', '),
    );
  }
  const results = await Promise.allSettled(owned.map((se) => se.delete()));
  const deleted = results.filter((r) => r.status === 'fulfilled').length;
  return {
    success: true,
    deleted,
    failed: results.length - deleted,
    skipped,
    total: all.length,
    ...(owned.length === 0 ? { reason: 'no-owned-events' } : {}),
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

/** Run the reconciliation cron once on demand — for idempotency smoke tests
 *  (ROK-1347). Returns success regardless of whether candidates existed. */
export async function triggerReconciliationForTest(
  moduleRef: ModuleRef,
): Promise<{ success: boolean }> {
  const svc = moduleRef.get(ScheduledEventReconciliationService, {
    strict: false,
  });
  await svc.reconcileMissingScheduledEvents();
  return { success: true };
}

/** Run the post-event follow-up cron once on demand — for smoke tests (ROK-1371). */
export async function triggerPostEventFollowupForTest(
  moduleRef: ModuleRef,
): Promise<{ success: boolean }> {
  const svc = moduleRef.get(PostEventFollowupService, { strict: false });
  await svc.runForTest();
  return { success: true };
}

/**
 * Force-record the post-event follow-up sentinel for an event, bypassing the M2
 * cron's ActiveEventCache + detection-window timing — makes the event-path
 * fan-out deterministically claimable in smoke tests without a cron race
 * (ROK-1371). M2 candidate detection is covered separately by the api
 * integration suite; this hook exists so the DM-delivery smoke is not flaky.
 */
export async function recordFollowupSentinelForTest(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<{ success: boolean }> {
  await db.execute(sql`
    INSERT INTO post_event_followup_sent (event_id)
    VALUES (${eventId})
    ON CONFLICT (event_id) DO NOTHING
  `);
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
