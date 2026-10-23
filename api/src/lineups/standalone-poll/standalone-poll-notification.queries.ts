/**
 * Read queries behind `StandalonePollNotificationService` — the linked event's
 * roster + start time and the creator's name. Extracted (ROK-1893 P3) to keep
 * the service under the 300-line cap.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The linked event's roster among a poll's recipients, plus its start. */
export interface RosterSplit {
  roster: number[];
  eventStartTime: Date | undefined;
}

/** Signed-up / tentative roster members of an event. */
async function findRosterMembers(db: Db, eventId: number): Promise<number[]> {
  const rows = await db.execute<{ userId: number }>(sql`
    SELECT es.user_id AS "userId"
    FROM event_signups es
    WHERE es.event_id = ${eventId}
      AND es.status IN ('signed_up', 'tentative')
      AND es.user_id IS NOT NULL
  `);
  return rows.map((r) => r.userId);
}

/** The start time of an event. */
async function findEventStartTime(
  db: Db,
  eventId: number,
): Promise<Date | undefined> {
  const rows = await db.execute<{ startTime: string }>(sql`
    SELECT lower(duration)::text AS "startTime"
    FROM events WHERE id = ${eventId} LIMIT 1
  `);
  const raw = rows[0]?.startTime;
  return raw ? new Date(raw.endsWith('Z') ? raw : raw + 'Z') : undefined;
}

/** The recipients on the linked event's roster, plus its start time. */
export async function splitRoster(
  db: Db,
  recipientIds: number[],
  linkedEventId: number,
): Promise<RosterSplit> {
  const [rosterIds, eventStartTime] = await Promise.all([
    findRosterMembers(db, linkedEventId),
    findEventStartTime(db, linkedEventId),
  ]);
  const rosterSet = new Set(rosterIds);
  return {
    roster: recipientIds.filter((id) => rosterSet.has(id)),
    eventStartTime,
  };
}

/** The creator's display name or username. */
export async function findCreatorName(
  db: Db,
  creatorId: number,
): Promise<string> {
  const rows = await db.execute<{
    displayName: string | null;
    username: string | null;
  }>(sql`
    SELECT display_name AS "displayName", username
    FROM users WHERE id = ${creatorId} LIMIT 1
  `);
  const row = rows[0];
  return row?.displayName || row?.username || 'Someone';
}
