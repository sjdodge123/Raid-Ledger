/**
 * ROK-1754 review (W2, S2, N1): the DB statements behind a rotation's
 * timing. Every stamp and every age read uses `clock_timestamp()` — the DB's
 * wall clock at the statement, not `NOW()` (transaction start, which would
 * silently freeze the re-stamp at the consume time inside a transaction) and
 * not the app's `Date.now()` (a different clock from the one that stamped
 * `rotated_at`).
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { IN_FLIGHT_MAX_MS } from './refresh-grace.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const t = schema.refreshTokens;

/** DB wall clock as a `timestamp` (the columns are without time zone). */
export const DB_CLOCK = sql`clock_timestamp()::timestamp`;

/** A compile-time constant, inlined (no bound-parameter type inference). */
const IN_FLIGHT_INTERVAL = sql.raw(`interval '${IN_FLIGHT_MAX_MS} milliseconds'`);

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
    .where(eq(t.id, parentId));
}
