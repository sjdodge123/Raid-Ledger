/**
 * Conversion-target validation for `POST /lfg/:gameId/convert`
 * (ROK-1451 rework — M1 / Codex P2-c).
 *
 * `converted_to_poll_id` / `converted_to_event_id` are provenance: they claim
 * "this group became THAT poll/event". Writing them straight from the request
 * body let a nonexistent id surface as an FK 500 and let a real-but-unrelated
 * id record a false claim for every member of the group. Both are resolved
 * here before anything is written.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import type { LfgConversionTarget } from './lfg-write.helpers';

/** The poll's game, or `undefined` when no such poll exists. */
async function pollGameId(
  db: LfgDb,
  pollId: number,
): Promise<number | undefined> {
  const [row] = await db
    .select({ gameId: schema.communityLineupMatches.gameId })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, pollId))
    .limit(1);
  return row?.gameId;
}

/** The event's game (nullable), or `undefined` when no such event exists. */
async function eventGameId(
  db: LfgDb,
  eventId: number,
): Promise<number | null | undefined> {
  const [row] = await db
    .select({ gameId: schema.events.gameId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ? row.gameId : undefined;
}

/**
 * Resolve the game the conversion target belongs to.
 *
 * @param db - Drizzle handle.
 * @param target - Exactly one of `pollId` / `eventId` (the schema enforces it).
 * @returns The target's `gameId`, `null` when the target has no game, or
 *   `undefined` when the target row does not exist at all.
 */
export function resolveTargetGameId(
  db: LfgDb,
  target: LfgConversionTarget,
): Promise<number | null | undefined> {
  return target.pollId !== undefined
    ? pollGameId(db, target.pollId)
    : eventGameId(db, target.eventId as number);
}
