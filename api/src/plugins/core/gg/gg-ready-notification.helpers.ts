/**
 * ROK-2187 — the per-player `gg_ready` in-app row is once per (user, year).
 * A failed DM enqueue releases the wave claim and the next 5-minute tick
 * retries; without this lookup every retry would add another in-app row.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';

/** Id of `userId`'s existing `gg_ready` notification for `year`, else null. */
export async function findGgReadyNotificationId(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  year: number,
): Promise<string | null> {
  const n = schema.notifications;
  const [row] = await db
    .select({ id: n.id })
    .from(n)
    .where(
      and(
        eq(n.userId, userId),
        eq(n.type, 'gg_ready'),
        sql`${n.payload}->>'year' = ${String(year)}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
