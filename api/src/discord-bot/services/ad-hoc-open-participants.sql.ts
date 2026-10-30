/**
 * ROK-2052 — "someone is still here" as one SQL predicate on `events`.
 *
 * A live Quick Play with an open participant row (`left_at IS NULL`, in voice
 * or on the game server) is occupied, not orphaned. The reaper must spare it
 * and auto-extend must keep it a candidate even after its effective end slid
 * out of the ±5 min window (prod Quick Play 288: extended once, missed the
 * next window while one player was briefly alone, then reaped with two
 * players still in it — which freed the binding to spawn a duplicate).
 *
 * Built with the query builder, not raw `sql` column interpolation: the outer
 * selects read a single table, where drizzle renders interpolated columns
 * unqualified and a correlated subquery would bind `id` to the inner table.
 */
import { and, eq, exists, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** True for an `events` row that has at least one open participant row. */
export function hasOpenParticipant(db: Db): SQL {
  const p = tables.adHocParticipants;
  return exists(
    db
      .select({ one: sql`1` })
      .from(p)
      .where(and(eq(p.eventId, tables.events.id), isNull(p.leftAt))),
  );
}

/** True for a live ad-hoc event that someone is still in (ROK-2052). */
export function isOccupiedLiveAdHoc(db: Db): SQL {
  return sql`(${tables.events.isAdHoc} = true AND ${tables.events.adHocStatus} = 'live' AND ${hasOpenParticipant(db)})`;
}
