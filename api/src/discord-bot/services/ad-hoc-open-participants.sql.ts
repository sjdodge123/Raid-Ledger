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
 * Columns interpolated into a WHERE are always table-qualified by drizzle (only
 * a single-table SELECT list drops the prefix), so the correlated EXISTS binds
 * `"events"."id"` to the outer row in every caller (select and update alike).
 */
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
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

/** Stale threshold: an ad-hoc event whose effective end is > 30 min ago. */
const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * ROK-2052 backstop: participant rows carry no heartbeat, so a leave missed
 * across a bot restart / gateway drop leaves a stale open row. An occupied
 * live event is spared only while its effective end is at most this far in
 * the past; beyond it the reaper ends it like any orphan, so a stale row
 * cannot pin a Quick Play live (and absorb every future spawn) forever.
 *
 * Worst-case lifetime: the ceiling is measured from the EFFECTIVE (extended)
 * end, so it stacks on auto-extend's max overage. Two or more stale open
 * server rows count as presence (`countServerOnlyPresence`), so auto-extend
 * keeps extending to originalEnd + maxOverage (default 12h), then the ceiling
 * adds 4h: ~16–17h from spawn for a default 1h Quick Play. Still bounded —
 * max overage stops the extensions and nothing else moves the end forward.
 */
export const AD_HOC_OCCUPIED_REAP_CEILING_MS = 4 * 60 * 60 * 1000;

/** An event's effective end: `extended_until`, else the end of `duration`. */
function effectiveEnd(): SQL {
  return sql`COALESCE(${tables.events.extendedUntil}, upper(${tables.events.duration}))`;
}

/**
 * Orphan eligibility as of `nowMs` — ONE predicate shared by the reaper's
 * finder and its claim UPDATE (ROK-2052 Codex P2), so a Quick Play that
 * gained a player or an extension between the two is not ended by the claim.
 * Live or grace_period, not cancelled, effective end > 30 min past — except a
 * live one someone is still in, until {@link AD_HOC_OCCUPIED_REAP_CEILING_MS}.
 */
export function orphanedAdHocConditions(
  db: Db,
  nowMs: number,
): (SQL | undefined)[] {
  const cutoff = new Date(nowMs - ORPHAN_THRESHOLD_MS).toISOString();
  const ceiling = new Date(nowMs - AD_HOC_OCCUPIED_REAP_CEILING_MS);
  const end = effectiveEnd();
  const pastCeiling = sql`${end} < ${ceiling.toISOString()}::timestamptz`;
  return [
    eq(tables.events.isAdHoc, true),
    inArray(tables.events.adHocStatus, ['live', 'grace_period']),
    isNull(tables.events.cancelledAt),
    sql`${end} < ${cutoff}::timestamptz`,
    or(pastCeiling, not(isOccupiedLiveAdHoc(db))),
  ];
}

/**
 * ROK-2052 (Codex P2) — is any live, occupied ad-hoc event due for an
 * auto-extend check (effective end <= `until`)? The auto-extend cache gate
 * only sees events <= 2h past their end; one that slipped further but got its
 * players back would otherwise never be extended before the reaper's ceiling.
 */
export async function anyOccupiedLiveAdHocDue(
  db: Db,
  until: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: tables.events.id })
    .from(tables.events)
    .where(
      and(
        isNull(tables.events.cancelledAt),
        isOccupiedLiveAdHoc(db),
        sql`${effectiveEnd()} <= ${until.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
