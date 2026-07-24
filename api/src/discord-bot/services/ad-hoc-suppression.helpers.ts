/**
 * ROK-1418 — ad-hoc (Quick Play) scheduled-event SUPPRESSION helpers.
 *
 * Extracted from `ad-hoc-event.helpers.ts` to free lines under the 300-line cap
 * and to isolate the two ROK-1418 fixes:
 *   1. `buildAnchoredGameClause` scopes the `events.game_id` suppression term to
 *      THIS voice channel, so a scheduled event demonstrably homed in a
 *      DIFFERENT voice channel no longer suppresses Quick Play here.
 *   2. `planSuppressionExtension` + `extendScheduledEventWindow` bound the
 *      suppression-window write (60m window / 15m refresh threshold / 6h ceiling,
 *      monotonic, SQL-guarded), replacing the always-fires `now+1h` rewrite that
 *      commit a46c6700 introduced via a hardcoded `null` currentExtended.
 *
 * OPERATOR RECOVERY — if Quick Play stays blocked on a channel because a
 * scheduled event's suppression window keeps refreshing, clear the window:
 *   UPDATE events SET extended_until = NULL WHERE id = <eid>;
 * Trace the decisions in the admin Logs export (tag `[voice-spawn]`):
 *   zgrep -h '\[voice-spawn\]' *.log*
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Logger } from '@nestjs/common';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import { findActiveScheduledEvent } from './ad-hoc-event.helpers';

export const SUPPRESSION_WINDOW_MS = 60 * 60 * 1000;
export const SUPPRESSION_REFRESH_THRESHOLD_MS = 15 * 60 * 1000;
export const SUPPRESSION_MAX_EXTENSION_MS = 6 * 60 * 60 * 1000;
// INVARIANT (ROK-1418): REFRESH_THRESHOLD must EXCEED the longest plausible gap
// between suppressed joins, because extended_until is itself the input to
// buildTimeConditions' third disjunct — if the window lapses between refreshes,
// a past-end event silently drops out of the suppression set.

export type SuppressionPlan =
  | { action: 'extend'; newEnd: Date }
  | { action: 'skip-fresh' }
  | { action: 'skip-capped'; ceiling: Date };

/**
 * Pure planner for the suppression-window extension. Targets a 60m forward
 * window, never moves the window backward, never advances past scheduledEnd+6h,
 * and skips entirely while the current window is still fresh (>= now+15m).
 */
export function planSuppressionExtension(
  scheduledEnd: Date,
  currentExtended: Date | null,
  now: Date,
): SuppressionPlan {
  const ceiling = new Date(
    scheduledEnd.getTime() + SUPPRESSION_MAX_EXTENSION_MS,
  );
  const target = new Date(
    Math.min(now.getTime() + SUPPRESSION_WINDOW_MS, ceiling.getTime()),
  );
  const freshFloor = now.getTime() + SUPPRESSION_REFRESH_THRESHOLD_MS;
  if (currentExtended && currentExtended.getTime() >= freshFloor) {
    return { action: 'skip-fresh' };
  }
  if (
    target.getTime() <= now.getTime() ||
    (currentExtended && target.getTime() <= currentExtended.getTime())
  ) {
    return { action: 'skip-capped', ceiling };
  }
  return { action: 'extend', newEnd: target };
}

/**
 * Channel-scoped game-suppression clause (ROK-1418). Without a `channelId` this
 * is byte-identical to the legacy bare `events.game_id = <id>` term. With one it
 * ALSO requires the event to not be demonstrably homed in a DIFFERENT voice
 * channel: its ephemeral channel is unset or this channel, AND its series is
 * either bound to this channel or bound to no voice channel at all.
 */
export function buildAnchoredGameClause(gameId: number, channelId?: string) {
  const gameMatch = sql`${tables.events.gameId} = ${gameId}`;
  if (!channelId) return gameMatch;
  return sql`(${gameMatch}
    AND (${tables.events.ephemeralVoiceChannelId} IS NULL
         OR ${tables.events.ephemeralVoiceChannelId} = ${channelId})
    AND (${tables.events.recurrenceGroupId} IS NULL
         OR EXISTS (SELECT 1 FROM channel_bindings cb
                     WHERE cb.recurrence_group_id = ${tables.events.recurrenceGroupId}
                       AND cb.channel_type = 'voice' AND cb.channel_id = ${channelId})
         OR NOT EXISTS (SELECT 1 FROM channel_bindings cb2
                         WHERE cb2.recurrence_group_id = ${tables.events.recurrenceGroupId}
                           AND cb2.channel_type = 'voice')))`;
}

/** Build the time-window WHERE conditions for scheduled event suppression. */
export function buildTimeConditions(now: Date) {
  const lookbackMs = 30 * 60 * 1000;
  const lookbackTime = new Date(now.getTime() - lookbackMs);
  return [
    eq(tables.events.isAdHoc, false),
    sql`${tables.events.cancelledAt} IS NULL`,
    sql`lower(${tables.events.duration}) <= ${now.toISOString()}::timestamptz`,
    sql`(upper(${tables.events.duration}) >= ${lookbackTime.toISOString()}::timestamptz OR ${tables.events.extendedUntil} >= ${now.toISOString()}::timestamptz)`,
  ] as const;
}

/** Build the binding/game/channel OR clause for suppression. */
export function buildBindingClause(
  bindingId: string,
  effectiveGameId: number | null | undefined,
  channelId?: string,
) {
  // ROK-1390: match sibling bindings on the same physical voice channel that are
  // either the game-voice-monitor purpose OR series-linked (a series bind may sit
  // under a general-lobby purpose after a bind flip). Reaching series siblings by
  // recurrence_group_id keeps quick-play suppressed during a live series event.
  const siblingSubquery = channelId
    ? sql`${tables.events.channelBindingId} IN (SELECT id FROM channel_bindings WHERE channel_id = ${channelId} AND (binding_purpose = 'game-voice-monitor' OR recurrence_group_id IS NOT NULL))`
    : undefined;
  if (effectiveGameId != null && siblingSubquery) {
    return sql`(${tables.events.channelBindingId} = ${bindingId} OR ${buildAnchoredGameClause(effectiveGameId, channelId)} OR ${siblingSubquery})`;
  }
  if (effectiveGameId != null) {
    return sql`(${tables.events.channelBindingId} = ${bindingId} OR ${buildAnchoredGameClause(effectiveGameId, channelId)})`;
  }
  if (siblingSubquery) {
    return sql`(${tables.events.channelBindingId} = ${bindingId} OR ${siblingSubquery})`;
  }
  return eq(tables.events.channelBindingId, bindingId);
}

/**
 * Monotonically extend a scheduled event's suppression window. The guard lives
 * in the SQL (`extended_until IS NULL OR extended_until < newEnd`) so concurrent
 * suppressed joins and the undebounced presence-update path can never race a
 * backward write. Returns whether a row was actually written.
 */
export async function extendScheduledEventWindow(
  db: PostgresJsDatabase<typeof schema>,
  scheduledEventId: number,
  newEnd: Date,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .update(tables.events)
    .set({ extendedUntil: newEnd, updatedAt: now })
    .where(
      and(
        eq(tables.events.id, scheduledEventId),
        sql`(${tables.events.extendedUntil} IS NULL OR ${tables.events.extendedUntil} < ${newEnd.toISOString()}::timestamptz)`,
      ),
    )
    .returning({ id: tables.events.id });
  return !!row;
}

// Module-local `[voice-spawn]` logger + skip-capped warn throttle (30-min TTL
// per event). A Redis/PG round trip per voice join is unacceptable, so the
// throttle is deliberately NOT the NotificationDedupService.
const logger = new Logger('AdHocSuppression');
const skipCappedWarnedAt = new Map<number, number>();
const SKIP_CAPPED_WARN_TTL_MS = 30 * 60 * 1000;
let totalWrites = 0;
let totalSkipped = 0;

/**
 * Orchestrate scheduled-event suppression for a Quick Play voice join: find a
 * live scheduled event and, when found, bound-extend its suppression window per
 * `planSuppressionExtension`. Returns true whenever a scheduled event suppresses
 * the spawn, whether or not the window was rewritten.
 */
export async function suppressScheduled(
  db: PostgresJsDatabase<typeof schema>,
  bindingId: string,
  effectiveGameId: number | null | undefined,
  channelId?: string,
): Promise<boolean> {
  const now = new Date();
  const scheduled = await findActiveScheduledEvent(
    db,
    bindingId,
    effectiveGameId,
    now,
    channelId,
  );
  if (!scheduled) return false;
  const plan = planSuppressionExtension(
    scheduled.scheduledEnd,
    scheduled.extendedUntil,
    now,
  );
  logger.debug(
    `[voice-spawn] suppressed binding=${bindingId} channel=${channelId ?? '-'} game=${effectiveGameId ?? '-'} event=${scheduled.id} match=${scheduled.matchedBy} window=${scheduled.extendedUntil?.toISOString() ?? 'none'}`,
  );
  await applySuppressionPlan(db, scheduled.id, plan, now);
  return true;
}

/** Apply a resolved suppression plan: monotonic write + counter logging. */
async function applySuppressionPlan(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  plan: SuppressionPlan,
  now: Date,
): Promise<void> {
  if (plan.action === 'extend') {
    const wrote = await extendScheduledEventWindow(
      db,
      eventId,
      plan.newEnd,
      now,
    );
    if (wrote) {
      totalWrites += 1;
      logger.log(
        `[voice-spawn] extended event=${eventId} until=${plan.newEnd.toISOString()} writes=${totalWrites} skipped=${totalSkipped} window=60m`,
      );
      return;
    }
  }
  totalSkipped += 1;
  if (plan.action === 'skip-capped') warnSkipCapped(eventId, plan.ceiling);
}

/** Throttled skip-capped warning (module-local Map, 30-min TTL per event). */
function warnSkipCapped(eventId: number, ceiling: Date): void {
  const last = skipCappedWarnedAt.get(eventId);
  const nowMs = Date.now();
  if (last && nowMs - last < SKIP_CAPPED_WARN_TTL_MS) return;
  skipCappedWarnedAt.set(eventId, nowMs);
  logger.warn(
    `[voice-spawn] skip-capped event=${eventId} ceiling=${ceiling.toISOString()} — Quick Play stays blocked until this event ends or extended_until is cleared`,
  );
}
