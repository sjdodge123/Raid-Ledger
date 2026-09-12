/**
 * Column selection + row shape shared by the user list endpoints.
 *
 * Extracted from `users-query.helpers.ts` (ROK-1530) to keep that file inside
 * the 300-line budget when `steamLinked` was added.
 */
import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** Basic user columns selected for list endpoints. */
export const USER_LIST_COLUMNS = {
  id: schema.users.id,
  username: schema.users.username,
  avatar: schema.users.avatar,
  discordId: schema.users.discordId,
  customAvatarUrl: schema.users.customAvatarUrl,
  /** ROK-1530 TD-2: derived flag so the invitee picker can warn about limited data. */
  steamLinked: sql<boolean>`${schema.users.steamId} is not null`,
} as const;

/** User list result type. */
export type UserListResult = {
  data: Array<{
    id: number;
    username: string;
    avatar: string | null;
    discordId: string | null;
    customAvatarUrl: string | null;
    steamLinked: boolean;
  }>;
  total: number;
};
