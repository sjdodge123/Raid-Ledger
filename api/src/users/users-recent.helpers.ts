import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, gte, desc } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { activeUsersFilter } from './users-active.helpers';

/** Find recently joined users (last N days, max M results). Skips deactivated (ROK-1260). */
export async function findRecentUsers(
  db: PostgresJsDatabase<typeof schema>,
  days: number,
  limit: number,
) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      discordId: schema.users.discordId,
      customAvatarUrl: schema.users.customAvatarUrl,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(and(gte(schema.users.createdAt, cutoff), activeUsersFilter()))
    .orderBy(desc(schema.users.createdAt))
    .limit(limit);
}
