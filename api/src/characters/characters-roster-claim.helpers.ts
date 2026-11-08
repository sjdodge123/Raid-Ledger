/**
 * ROK-2128 — `CharacterDto.rosterClaimed`: was this character claimed from a
 * guild roster pick? Derived (no column, spec D2/D7) from the claim's
 * `activity_log` row; the roster-claim plugin writes it and imports these
 * constants so the two sides cannot drift. A reassign keeps the flag (the
 * character is still the roster row's); an unlink deletes the character.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** `activity_log.entity_type` of roster-claim + admin ownership audits. */
export const CHARACTER_CLAIM_ENTITY = 'character_claim';

/** `activity_log.action` written when a player claims a roster row. */
export const ROSTER_CLAIMED_ACTION = 'roster_claimed';

const { activityLog } = schema;

/** True when a `roster_claimed` audit row names `characterId`. */
export async function isRosterClaimed(
  db: PostgresJsDatabase<typeof schema>,
  characterId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, CHARACTER_CLAIM_ENTITY),
        eq(activityLog.action, ROSTER_CLAIMED_ACTION),
        sql`${activityLog.metadata}->>'characterId' = ${characterId}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
