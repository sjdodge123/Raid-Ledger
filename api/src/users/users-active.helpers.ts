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
