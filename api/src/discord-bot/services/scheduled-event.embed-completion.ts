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
 * enqueues the same `cron-complete` sync. It runs after the Discord pass
 * (including when that pass found no candidates) but only while the bot is
 * connected to a guild: the processor needs the connection and only syncs the
 * current guild's embeds, so a disconnected sweep would just fail its jobs.
 * The next connected tick picks the event up again (its embed is still live).
 *
 * Newest-ended first: an event whose embed edit keeps failing (message
 * deleted, channel access lost) never leaves the candidate set, so an
 * unordered batch could let such rows starve a freshly ended event.
 *
 * Idempotent: an event whose every tracked embed is already COMPLETED or
 * CANCELLED is never returned, and ids the Discord pass just enqueued are
 * excluded (that pass clears the SE id, so they would otherwise match too).
 */
import { and, desc, eq, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
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

/** Filters for `findEmbedOnlyCompletionCandidates`. */
export interface EmbedOnlyCandidateQuery {
  /** Only embeds tracked for this guild — the one the processor syncs. */
  guildId: string;
  excludeIds?: number[];
  now?: Date;
  limit?: number;
}

/** True while one of the guild's tracked embeds for the event is not finished. */
function hasUnfinishedEmbed(guildId: string): SQL {
  const dem = schema.discordEventMessages;
  return sql`EXISTS (
    SELECT 1 FROM ${dem}
    WHERE ${dem.eventId} = ${schema.events.id}
      AND ${dem.guildId} = ${guildId}
      AND ${dem.embedState} NOT IN (${EMBED_STATES.COMPLETED}, ${EMBED_STATES.CANCELLED})
  )`;
}

/**
 * Ended, non-cancelled, non-ad-hoc events with NO Discord scheduled event
 * whose posted embed has not reached COMPLETED (ROK-1818), newest-ended
 * first. Bounded by `EMBED_COMPLETION_LOOKBACK_MS` and the batch size.
 */
export async function findEmbedOnlyCompletionCandidates(
  db: PostgresJsDatabase<typeof schema>,
  query: EmbedOnlyCandidateQuery,
): Promise<number[]> {
  const { guildId, excludeIds = [], now = new Date() } = query;
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
        hasUnfinishedEmbed(guildId),
      ),
    )
    .orderBy(desc(effectiveEnd()), desc(schema.events.id))
    .limit(query.limit ?? EMBED_COMPLETION_BATCH_SIZE);
  return rows.map((r) => r.id);
}

/**
 * Enqueue a `cron-complete` embed sync for every embed-only candidate of the
 * guild. Never throws: a fault here must not fail the completion cron.
 * Returns the ids handed to the queue (`EmbedSyncQueueService.enqueue` logs
 * and swallows its own failures, so it never rejects).
 */
export async function sweepEmbedOnlyCompletions(
  db: PostgresJsDatabase<typeof schema>,
  queue: EmbedSyncEnqueuer,
  query: EmbedOnlyCandidateQuery,
  warn: (message: string) => void,
): Promise<number[]> {
  try {
    const ids = await findEmbedOnlyCompletionCandidates(db, query);
    for (const id of ids) await queue.enqueue(id, 'cron-complete');
    return ids;
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
 * while the bot is connected to a guild, skipping the ids the pass enqueued.
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
      await queue?.enqueue(id, 'cron-complete');
    },
  });
  if (!queue) return run;
  const guildId = client.isConnected() ? client.getGuildId() : null;
  if (!guildId) return run;
  const excludeIds = run.outcomes.map((o) => o.eventId);
  const swept = await sweepEmbedOnlyCompletions(
    db,
    queue,
    { guildId, excludeIds },
    warn,
  );
  return swept.length > 0 ? { ...run, embedOnlyEventIds: swept } : run;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}
