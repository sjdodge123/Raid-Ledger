/**
 * WARN-only channel-binding health reporter (ROK-1389, Part 3).
 *
 * Run once at bot-ready to surface series voice bindings that would silently
 * resolve to the wrong channel. It NEVER mutates: a post-ROK-1372 game-locked
 * series bind (`/bind … game:`) is shape-indistinguishable from pre-1372
 * residue, so an every-boot UPDATE would permanently clobber deliberate operator
 * intent. The one-shot data repair (residue → general-lobby) ships separately
 * after operator sign-off. This reporter only reads + logs.
 */
import { and, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type WarnLogger = { warn: (msg: string) => void };

/** Minimal binding shape the reporter inspects. */
export interface HealBinding {
  channelId: string;
  channelType: string;
  bindingPurpose: string;
  gameId: number | null;
  recurrenceGroupId: string | null;
}

/**
 * A series voice binding still carrying the pre-ROK-1372 shape
 * (game-voice-monitor + stored gameId) rather than a series-following bind. This
 * is what breaks Tier-1 resolution when the weekly instance's game differs.
 */
function isPreRok1372Residue(b: HealBinding): boolean {
  return (
    b.recurrenceGroupId !== null &&
    b.channelType === 'voice' &&
    b.bindingPurpose === 'game-voice-monitor' &&
    b.gameId !== null
  );
}

/** Recurrence groups that still have a future / ongoing, non-cancelled event. */
async function findGroupsWithFutureEvents(
  db: Db,
  groups: string[],
): Promise<Set<string>> {
  if (groups.length === 0) return new Set();
  const now = new Date();
  const rows = await db
    .select({ recurrenceGroupId: schema.events.recurrenceGroupId })
    .from(schema.events)
    .where(
      and(
        isNull(schema.events.cancelledAt),
        inArray(schema.events.recurrenceGroupId, groups),
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
      ),
    );
  return new Set(
    rows.map((r) => r.recurrenceGroupId).filter((g): g is string => g !== null),
  );
}

/**
 * Log WARN for (a) pre-1372 residue-shaped series voice bindings and (b) series
 * bindings whose recurrence group has no future non-cancelled event (rot →
 * operator must re-run `/bind`). Read-only: mutates nothing, asserts nothing.
 */
export async function reportBindingHealthWarnings(
  db: Db,
  bindings: HealBinding[],
  logger: WarnLogger,
): Promise<void> {
  const seriesBindings = bindings.filter((b) => b.recurrenceGroupId !== null);
  if (seriesBindings.length === 0) return;

  for (const b of seriesBindings) {
    if (isPreRok1372Residue(b)) {
      logger.warn(
        `[binding-heal] series voice binding channel=${b.channelId} group=${b.recurrenceGroupId} carries pre-ROK-1372 game-voice-monitor+gameId=${b.gameId} shape; re-run /bind so it follows this week's instance`,
      );
    }
  }

  const groups = [...new Set(seriesBindings.map((b) => b.recurrenceGroupId!))];
  const liveGroups = await findGroupsWithFutureEvents(db, groups);
  for (const b of seriesBindings) {
    if (!liveGroups.has(b.recurrenceGroupId!)) {
      logger.warn(
        `[binding-heal] series binding channel=${b.channelId} group=${b.recurrenceGroupId} matches no future non-cancelled event (binding rot); re-run /bind`,
      );
    }
  }
}
