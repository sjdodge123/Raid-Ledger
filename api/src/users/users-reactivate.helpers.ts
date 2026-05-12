import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { invalidateAuthUser } from '../auth/auth-user-cache';

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
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  logger: Logger,
): Promise<typeof schema.users.$inferSelect | undefined> {
  const [updated] = await db
    .update(schema.users)
    .set({ deactivatedAt: null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning();
  invalidateAuthUser(userId);
  logger.log(`Admin reactivated user ${userId}`);
  return updated;
}
