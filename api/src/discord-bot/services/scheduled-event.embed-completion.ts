/**
 * Embed-only completion sweep (ROK-1818).
 *
 * The completion cron's Discord pass (`runCompletionPass`) only visits events
 * that still carry a Discord scheduled event, and only those got the
 * `cron-complete` embed sync that moves the channel embed to COMPLETED and
 * deletes the "Spots still available" bump (ROK-1812). An event that never
 * had a scheduled event — scheduled events disabled, creation failed or was
 * skipped — kept a live embed and bump forever.
 *
 * This sweep finds those events from Raid Ledger's own effective end time and
 * enqueues the same `cron-complete` sync. It runs after the Discord pass and
 * regardless of its skip reason: it needs only the DB and the embed-sync
 * queue, and the processor itself no-ops while the bot is disconnected (the
 * next tick then picks the event up again, since its embed is still live).
 *
 * Idempotent: an event whose every tracked embed is already COMPLETED or
 * CANCELLED is never returned, and ids the Discord pass just enqueued are
 * excluded (that pass clears the SE id, so they would otherwise match too).
 */
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { utcWallClock } from '../../drizzle/timestamp-utils';
import { EMBED_STATES } from '../discord-bot.constants';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { effectiveEnd } from './scheduled-event.db-helpers';
import {
  runCompletionPass,
  type SECompletionOutcome,
  type SECompletionRun,
} from './scheduled-event.completion';

/** How far back an ended event stays eligible for the sweep. */
export const EMBED_COMPLETION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum events enqueued per cron tick. */
export const EMBED_COMPLETION_BATCH_SIZE = 25;

/** The enqueue half of `EmbedSyncQueueService` the sweep needs. */
export interface EmbedSyncEnqueuer {
  enqueue(eventId: number, reason: string): Promise<void>;
}

/** True while at least one tracked embed for the event is not finished. */
function hasUnfinishedEmbed() {
  const dem = schema.discordEventMessages;
  return sql`EXISTS (
    SELECT 1 FROM ${dem}
    WHERE ${dem.eventId} = ${schema.events.id}
      AND ${dem.embedState} NOT IN (${EMBED_STATES.COMPLETED}, ${EMBED_STATES.CANCELLED})
  )`;
}

/**
 * Ended, non-cancelled, non-ad-hoc events with NO Discord scheduled event
 * whose posted embed has not reached COMPLETED (ROK-1818). Bounded by
 * `EMBED_COMPLETION_LOOKBACK_MS` and `EMBED_COMPLETION_BATCH_SIZE`.
 */
export async function findEmbedOnlyCompletionCandidates(
  db: PostgresJsDatabase<typeof schema>,
  excludeIds: number[] = [],
  now: Date = new Date(),
): Promise<number[]> {
  const since = new Date(now.getTime() - EMBED_COMPLETION_LOOKBACK_MS);
  const rows = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        isNull(schema.events.discordScheduledEventId),
        isNull(schema.events.cancelledAt),
        // The processor skips both (ROK-1370 / ROK-1447) — enqueueing would
        // only churn the queue every tick.
        isNull(schema.events.reschedulingPollId),
        eq(schema.events.isAdHoc, false),
        sql`${effectiveEnd()} < ${utcWallClock(now)}`,
        sql`${effectiveEnd()} >= ${utcWallClock(since)}`,
        excludeIds.length > 0
          ? notInArray(schema.events.id, excludeIds)
          : undefined,
        hasUnfinishedEmbed(),
      ),
    )
    .limit(EMBED_COMPLETION_BATCH_SIZE);
  return rows.map((r) => r.id);
}

/** Enqueue one `cron-complete` sync; true when it was accepted. Never throws. */
async function enqueueCronComplete(
  queue: EmbedSyncEnqueuer | null,
  id: number,
  warn: (message: string) => void,
): Promise<boolean> {
  if (!queue) return false;
  try {
    await queue.enqueue(id, 'cron-complete');
    return true;
  } catch (err) {
    warn(`Embed-sync enqueue failed for event ${id}: ${errText(err)}`);
    return false;
  }
}

/**
 * Enqueue a `cron-complete` embed sync for every embed-only candidate.
 * Never throws: a fault here must not fail the completion cron. Returns the
 * ids it enqueued (an enqueue that rejected is logged and left out).
 */
export async function sweepEmbedOnlyCompletions(
  db: PostgresJsDatabase<typeof schema>,
  queue: EmbedSyncEnqueuer | null,
  excludeIds: number[],
  warn: (message: string) => void,
): Promise<number[]> {
  if (!queue) return [];
  try {
    const ids = await findEmbedOnlyCompletionCandidates(db, excludeIds);
    const enqueued: number[] = [];
    for (const id of ids) {
      if (await enqueueCronComplete(queue, id, warn)) enqueued.push(id);
    }
    return enqueued;
  } catch (err) {
    warn(`Embed-only completion sweep failed: ${errText(err)}`);
    return [];
  }
}

/** What the completion cron needs from `ScheduledEventService`. */
export interface CompletionCronDeps {
  db: PostgresJsDatabase<typeof schema>;
  client: DiscordBotClientService;
  queue: EmbedSyncEnqueuer | null;
  completeOne: (eventId: number) => Promise<SECompletionOutcome>;
  warn: (message: string) => void;
}

/**
 * The completion cron (ROK-717, ROK-944, ROK-1818): the Discord SE pass,
 * each completed event's `cron-complete` sync, then the embed-only sweep —
 * which runs whatever the pass's skip reason and skips the ids it enqueued.
 */
export async function completeAndSweep(
  deps: CompletionCronDeps,
): Promise<SECompletionRun> {
  const { db, client, queue, completeOne, warn } = deps;
  const run = await runCompletionPass({
    db,
    client,
    completeOne,
    afterEach: async (id) => {
      await enqueueCronComplete(queue, id, warn);
    },
  });
  const done = run.outcomes.map((o) => o.eventId);
  const swept = await sweepEmbedOnlyCompletions(db, queue, done, warn);
  return swept.length > 0 ? { ...run, embedOnlyEventIds: swept } : run;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}
