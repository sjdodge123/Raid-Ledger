/**
 * Bulk sync helpers for Steam library sync (ROK-774).
 * Extracted from steam.service.ts for file size compliance.
 */
import { Logger } from '@nestjs/common';
import { isNotNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

const logger = new Logger('SteamBulkSync');

/** Inter-user delay to be respectful to Steam API. */
const USER_DELAY_MS = 200;

/** Sync all users who have linked Steam accounts. */
export async function syncAllLinkedUsers(
  db: PostgresJsDatabase<typeof schema>,
  syncFn: (userId: number) => Promise<{ newInterests: number }>,
): Promise<{ usersProcessed: number; totalNewInterests: number }> {
  const users = await db
    .select({ id: schema.users.id, steamId: schema.users.steamId })
    .from(schema.users)
    .where(isNotNull(schema.users.steamId));

  let usersProcessed = 0;
  let totalNewInterests = 0;

  for (const user of users) {
    try {
      const result = await syncFn(user.id);
      totalNewInterests += result.newInterests;
      usersProcessed++;
    } catch (error) {
      logger.warn(
        `Steam sync failed for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, USER_DELAY_MS));
  }

  logger.log(
    `Steam bulk sync: ${usersProcessed}/${users.length} users, ${totalNewInterests} new interests`,
  );
  return { usersProcessed, totalNewInterests };
}
