import { isNull } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/**
 * Drizzle predicate filtering to active (non-deactivated) users (ROK-1260).
 *
 * Composes with `and(...)` inside `.where()` clauses to filter out users
 * whose `deactivated_at` column is non-null (i.e., they left the Discord
 * guild and were auto-deactivated by the notification processor).
 */
export function activeUsersFilter() {
  return isNull(schema.users.deactivatedAt);
}

/** Raw SQL fragment for callers that use raw `sql\`...\`` queries instead of Drizzle's query builder. */
export const ACTIVE_USERS_SQL_AND = ' AND u.deactivated_at IS NULL ';

/**
 * Raw SQL fragment for "reachable member" — active AND not kicked AND not banned
 * (ROK-1371). The batch DM path (`dispatchMany`) only checks `deactivated_at`, so
 * kick/ban callers must add this predicate themselves. Assumes the `users` table
 * is aliased `u`.
 */
export const ACTIVE_MEMBER_SQL_AND =
  ' AND u.deactivated_at IS NULL AND u.banned_at IS NULL AND u.kicked_at IS NULL ';
