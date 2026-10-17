import type { CharacterDto, UserProfileResponse } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';

type ProfileUser = Pick<
  typeof schema.users.$inferSelect,
  | 'id'
  | 'username'
  | 'avatar'
  | 'discordId'
  | 'customAvatarUrl'
  | 'steamId'
  | 'createdAt'
>;

/**
 * Member-shape `GET /users/:id/profile` payload (ROK-1734).
 *
 * `steamId` is owner-only (Q1) and never leaves this function; every viewer
 * gets the `steamLinked` boolean instead (Q3). Anonymous viewers then receive
 * this through `projectUserProfile`, which strips `discordId`.
 */
export function buildUserProfile(
  user: ProfileUser,
  characters: CharacterDto[],
): UserProfileResponse {
  return {
    data: {
      id: user.id,
      username: user.username,
      avatar: user.avatar || null,
      discordId: user.discordId || null,
      customAvatarUrl: user.customAvatarUrl || null,
      steamLinked: !!user.steamId,
      createdAt: user.createdAt.toISOString(),
      characters,
    },
  };
}
