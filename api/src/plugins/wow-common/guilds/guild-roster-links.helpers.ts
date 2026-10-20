import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { GUID_AUDIT_ENTITY } from '../addon-import/addon-import.guid-audit';
import type { RawRosterRow, RosterLinks } from './guild-roster.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const { characters: c, users, activityLog: al } = schema;

/**
 * ROK-1794 (review): since when the character's GUID link is the one a member
 * grant can confirm — its creation or its latest GUID claim (first pin or
 * repin), whichever is later. `hasConfirmedMemberGrant` honours a grant
 * exactly when it was made at or after this moment (character created ≤
 * grant, no claim after the grant): the same "confirmed link" time.
 */
export function linkConfirmedAt() {
  const lastClaim = sql`(select max(${al.createdAt}) from ${al} where ${and(
    eq(al.entityType, GUID_AUDIT_ENTITY),
    eq(al.action, 'addon_guid_claimed'),
    sql`${al.metadata}->>'characterId' = ${c.id}::text`,
  )})`;
  return sql<Date>`greatest(${c.createdAt}, ${lastClaim})`.mapWith(c.createdAt);
}

/**
 * STAFF-ONLY (the caller gates it): the RL account behind each linked roster
 * row and since when, keyed by linked character id.
 */
export async function loadRosterLinks(
  db: Db,
  rows: RawRosterRow[],
): Promise<RosterLinks> {
  const ids = [
    ...new Set(rows.flatMap((r) => (r.characterId ? [r.characterId] : []))),
  ];
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: c.id, username: users.username, since: linkConfirmedAt() })
    .from(c)
    .innerJoin(users, eq(users.id, c.userId))
    .where(inArray(c.id, ids));
  return new Map(
    found.map((r) => [
      r.id,
      { username: r.username, linkedSince: new Date(r.since).toISOString() },
    ]),
  );
}
