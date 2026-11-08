/**
 * Discord-id signup ownership (ROK-2097). A Discord id may reach a guest
 * signup (`user_id` NULL) or a signup owned by the RL user it is linked to —
 * never a signup owned by another account (after an unlink or re-link).
 */
import { eq, and, or, isNull, sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';

/** Fail-closed fallback: an ownership guard that matches no row. */
const NONE: SQL = sql`false`;

/**
 * Ownership filter for a signup resolved by Discord id (ROK-2097).
 * A Discord-only guest signup (`user_id` NULL) always matches; a signup owned
 * by an RL user matches only when that user is the caller. With no caller
 * (an unlinked Discord user), only guest signups match — so a Discord id that
 * was re-linked or unlinked can never reach the previous owner's signup.
 */
export function unclaimedOrOwnedBy(callerUserId?: number): SQL {
  const unclaimed = isNull(schema.eventSignups.userId);
  if (callerUserId === undefined) return unclaimed;
  return or(unclaimed, eq(schema.eventSignups.userId, callerUserId)) ?? NONE;
}

/**
 * WHERE clause for "the signup this Discord id may manage": the row carries
 * the Discord id AND is a guest row or owned by the RL user the Discord id is
 * linked to right now (resolved here — `users.discord_id` is unique).
 */
export async function discordManagedSignupCondition(
  db: Tx,
  discordUserId: string,
): Promise<SQL> {
  const [linked] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);
  return (
    and(
      eq(schema.eventSignups.discordUserId, discordUserId),
      unclaimedOrOwnedBy(linked?.id),
    ) ?? NONE
  );
}
