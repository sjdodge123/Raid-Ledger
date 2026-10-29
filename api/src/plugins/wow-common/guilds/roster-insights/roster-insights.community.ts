import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';
import { ownerIsActive } from '../guild-roster.helpers';

/**
 * ROK-1925 (D1–D3) — the roster of a `game_community` hub: every WoW: Forever
 * character owned by the hub's live members. The hub's own game must be the
 * Forever game too (a BG3 community never shows WoW characters, AC8), and a
 * deactivated owner's characters never count (D3, same gate as guild links).
 */

type Db = PostgresJsDatabase<typeof schema>;

/** One community roster row: a character, never a `guild_members` row. */
export interface CommunityRosterRow {
  characterId: string;
  name: string;
  userId: number;
  isMain: boolean;
}

/** Forever characters of `userIds` on hub `hubId`'s (Forever) game. */
export async function loadCommunityRosterRows(
  db: Db,
  hubId: number,
  userIds: readonly number[],
): Promise<CommunityRosterRow[]> {
  if (userIds.length === 0) return [];
  const { characters, games, guilds } = schema;
  return db
    .select({
      characterId: characters.id,
      name: characters.name,
      userId: characters.userId,
      isMain: characters.isMain,
    })
    .from(characters)
    .innerJoin(games, eq(games.id, characters.gameId))
    .innerJoin(guilds, eq(guilds.gameId, characters.gameId))
    .where(
      and(
        eq(guilds.id, hubId),
        eq(games.slug, WOW_FOREVER_GAME_SLUG),
        inArray(characters.userId, [...userIds]),
        ownerIsActive(),
      ),
    );
}
