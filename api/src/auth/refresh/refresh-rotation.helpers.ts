/**
 * ROK-1754 review (W2, S2, N1): the DB statements behind a rotation's
 * timing. Every stamp and every age read uses `clock_timestamp()` — the DB's
 * wall clock at the statement, not `NOW()` (transaction start, which would
 * silently freeze the re-stamp at the consume time inside a transaction) and
 * not the app's `Date.now()` (a different clock from the one that stamped
 * `rotated_at`).
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { IN_FLIGHT_MAX_MS } from './refresh-grace.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const t = schema.refreshTokens;

/**
 * DB wall clock as a UTC `timestamp` (the columns are without time zone and
 * the app writes UTC) — explicit, so it never depends on the session TimeZone.
 */
export const DB_CLOCK = sql`(clock_timestamp() AT TIME ZONE 'UTC')`;

/** A compile-time constant, inlined (no bound-parameter type inference). */
const IN_FLIGHT_INTERVAL = sql.raw(
  `interval '${IN_FLIGHT_MAX_MS} milliseconds'`,
);

/**
 * The presented row plus `rotatedAgoMs`, computed in the SAME query on the
 * DB clock (null when the row was never consumed).
 */
export async function findReplayCandidate(db: Db, tokenHash: string) {
  const [row] = await db
    .select({
      id: t.id,
      userId: t.userId,
      familyId: t.familyId,
      authMethod: t.authMethod,
      userAgent: t.userAgent,
      revokedAt: t.revokedAt,
      replacedBy: t.replacedBy,
      rotatedAgoMs: sql<number | null>`
        (EXTRACT(EPOCH FROM (${DB_CLOCK} - ${t.rotatedAt})) * 1000)::float8
      `.mapWith(Number),
    })
    .from(t)
    .where(eq(t.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

/**
 * The FIRST child was issued: link it and re-stamp `rotatedAt` so the race
 * grace runs from issue. The re-stamp is capped at consume +
 * IN_FLIGHT_MAX_MS, so the grace window can never outlive the Redis
 * once-key (`GRACE_KEY_TTL_MS`). A grace sibling never calls this: it must
 * not end the in-flight state early (review W2), and leaving `replacedBy`
 * to the first child keeps this correct whichever of the two lands first.
 */
export async function markFirstChildIssued(
  db: Db,
  parentId: string,
  childId: string,
): Promise<void> {
  await db
    .update(t)
    .set({
      replacedBy: childId,
      rotatedAt: sql`LEAST(${DB_CLOCK}, ${t.rotatedAt} + ${IN_FLIGHT_INTERVAL})`,
    })
    .where(and(eq(t.id, parentId), isNull(t.replacedBy)));
}

// ── ROK-1809: per-family serialisation of rotation vs revocation ─────────

/**
 * Advisory-lock class for refresh families. The two-argument
 * `pg_advisory_xact_lock(int4, int4)` keyspace is disjoint from the one-arg
 * form and from `GAMES_NAME_LOCK_CLASS`, so no other lock user can collide.
 */
export const REFRESH_FAMILY_LOCK_CLASS = 1809;

/**
 * Take the family's transaction-scoped lock. Every path that consumes,
 * mints into or revokes a family holds it, so a revoke's UPDATE (a new
 * READ COMMITTED snapshot taken AFTER the lock) always sees a child minted
 * by a rotation that held the lock first — and a rotation that waits behind
 * a revoke sees the revocation on its conditional consume.
 */
export async function lockFamily(tx: Db, familyId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${REFRESH_FAMILY_LOCK_CLASS}::int4, hashtext(${familyId}::text))`,
  );
}

/**
 * Lock the family of the presented token. Returns its family id, or null
 * (no lock taken) when no row has that hash. `family_id` never changes, so
 * reading it before the lock is safe.
 */
export async function lockFamilyOfToken(
  tx: Db,
  tokenHash: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ familyId: t.familyId })
    .from(t)
    .where(eq(t.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  await lockFamily(tx, row.familyId);
  return row.familyId;
}

/**
 * Lock every family of `userId` that still has a live row, in lock-KEY
 * order: any two multi-family lockers then acquire overlapping keys in the
 * same order and cannot deadlock (single-family lockers hold one key and
 * take it before any row lock). A family with no live row cannot mint, so
 * it needs no lock.
 */
export async function lockUserFamilies(tx: Db, userId: number): Promise<void> {
  const rows = await tx
    .selectDistinct({
      familyId: sql<string>`${t.familyId}::text`,
      lockKey: sql<number>`hashtext(${t.familyId}::text)`.mapWith(Number),
    })
    .from(t)
    .where(and(eq(t.userId, userId), isNull(t.revokedAt)));
  const ordered = [...rows].sort(
    (a, b) => a.lockKey - b.lockKey || (a.familyId < b.familyId ? -1 : 1),
  );
  for (const { familyId } of ordered) await lockFamily(tx, familyId);
}

/** Atomically consume the row if it is live; returns it or undefined. */
export async function consumeRow(tx: Db, tokenHash: string) {
  const [row] = await tx
    .update(t)
    .set({ rotatedAt: DB_CLOCK })
    .where(
      and(
        eq(t.tokenHash, tokenHash),
        isNull(t.rotatedAt),
        isNull(t.revokedAt),
        sql`${t.expiresAt} > NOW()`,
      ),
    )
    .returning();
  return row;
}

/** Has the row been revoked? Re-checked under the family lock. */
export async function rowIsRevoked(tx: Db, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ revokedAt: t.revokedAt })
    .from(t)
    .where(eq(t.id, id))
    .limit(1);
  return row?.revokedAt != null;
}

/** Revoke every live row matching `scope` (a family or a user). */
export async function revokeActiveRows(tx: Db, scope: SQL): Promise<void> {
  await tx
    .update(t)
    .set({ revokedAt: sql`NOW()` })
    .where(and(scope, isNull(t.revokedAt)));
}
