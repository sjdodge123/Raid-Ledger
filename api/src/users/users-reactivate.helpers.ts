import { Logger } from '@nestjs/common';
import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { invalidateAuthUser } from '../auth/auth-user-cache';
import { refreshUserHubCounts } from '../guilds/community/community-membership.queries';
import {
  auditOwnerReactivated,
  lockDeactivatedAt,
} from '../plugins/wow-common/addon-import/external-id.owner-status';

type Db = PostgresJsDatabase<typeof schema>;
type UserRow = typeof schema.users.$inferSelect;

/**
 * Admin-triggered user reactivation (ROK-1260 AC-9).
 *
 * Clears `deactivated_at` on the target user. Does NOT emit the admin
 * reactivation in-app notification — that's reserved for the Discord
 * `guildMemberAdd` listener (operator-decision: only guild rejoin
 * notifies).
 *
 * Extracted from `users.service.ts` to keep that file under the 300-line
 * STRICT limit.
 */
export async function reactivateUserById(
  db: Db,
  userId: number,
  logger: Logger,
): Promise<typeof schema.users.$inferSelect> {
  const updated = await clearDeactivation(db, eq(schema.users.id, userId));
  if (!updated) {
    throw new Error(`reactivateUserById: user ${userId} not found`);
  }
  // ROK-1870: the user's community hubs count them again (M11).
  await refreshUserHubCounts(db, userId);
  invalidateAuthUser(userId);
  logger.log(`Admin reactivated user ${userId}`);
  return updated;
}

/**
 * Clear `deactivated_at` on the (single) user `where` matches. ROK-2160
 * (Codex P1): in the same tx, re-audit the rows the user's GUIDs win back
 * that staff granted while they were away, so that grant (made for someone
 * else) is not inherited. No actor: admin reactivation and guild rejoin both
 * arrive without one.
 *
 * The target is picked by a LOCKING select on the full `where`, and the
 * UPDATE repeats it: a ban committing while we wait for the row lock makes
 * Postgres re-check `banned_at IS NULL` on the new row version, so a rejoin
 * never un-deactivates a just-banned user (ROK-313 guard, review r2 M1).
 */
async function clearDeactivation(
  db: Db,
  where: SQL | undefined,
): Promise<UserRow | undefined> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(where)
      .limit(1)
      .for('update');
    if (!target) return undefined;
    const since = await lockDeactivatedAt(tx, target.id);
    const [row] = await tx
      .update(schema.users)
      .set({ deactivatedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.users.id, target.id), where))
      .returning();
    if (row && since) await auditOwnerReactivated(tx, row.id, since, null);
    return row;
  });
}

/**
 * ROK-1260 guild rejoin: reactivate the deactivated, NOT banned user with
 * this Discord id (ROK-313: a banned rejoiner stays deactivated).
 */
export async function reactivateOnGuildRejoin(
  db: Db,
  discordId: string,
): Promise<UserRow | undefined> {
  return clearDeactivation(
    db,
    and(
      eq(schema.users.discordId, discordId),
      isNotNull(schema.users.deactivatedAt),
      isNull(schema.users.bannedAt),
    ),
  );
}
