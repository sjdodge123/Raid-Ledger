/**
 * ROK-1821 (RCA F4) — the name and avatar a game-server (Steam) row shows.
 *
 * Spike ruling: the in-game character name is for UNLINKED players only. A
 * player whose SteamID resolves to a Raid Ledger user shows as that user —
 * `users.display_name`, else `users.username`. Rows carrying a `user_id` are never renamed to a
 * character name; unlinked rows keep following renames.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const t = schema.adHocParticipants;

/** The display columns a Steam row is written with. */
export interface SteamRowDisplay {
  discordUsername: string;
  /** ROK-1822: the character name, linked or not; null until one is known. */
  characterName: string | null;
  /** ROK-1822 r3: the owner id that goes with `characterName`, else null. */
  characterOwnerId: string | null;
}

/** The fields of a server player that decide how their row is shown. */
export interface SteamDisplayInput {
  /** SteamID64. */
  steamId: string;
  /** In-game character name, else the SteamID64. */
  displayName: string;
  /** The linked RL user, else null. */
  userId: number | null;
  /** The owner id of the character line that named them, when known. */
  characterOwnerId?: string;
}

/** A player's character name, or null while they are only a SteamID64. */
export function characterNameOf(player: {
  steamId: string;
  displayName: string;
}): string | null {
  return player.displayName === player.steamId ? null : player.displayName;
}

/**
 * The name to write for a server player: the linked user's Raid Ledger
 * name, else the character name. A user id that no longer resolves falls
 * back to the character name. No avatar (ROK-1822 NIT 7): the web builds
 * one only from a Discord id, which a Steam row never has.
 */
export async function resolveSteamRowDisplay(
  db: Db,
  member: SteamDisplayInput,
): Promise<SteamRowDisplay> {
  const characterName = characterNameOf(member);
  const characterOwnerId =
    characterName === null ? null : (member.characterOwnerId ?? null);
  const character = { characterName, characterOwnerId };
  const unlinked = { discordUsername: member.displayName, ...character };
  if (member.userId === null) return unlinked;
  const u = schema.users;
  const rows = await db
    .select({ displayName: u.displayName, username: u.username })
    .from(u)
    .where(eq(u.id, member.userId))
    .limit(1);
  const user = rows[0];
  if (!user) return unlinked;
  return { discordUsername: user.displayName ?? user.username, ...character };
}

/**
 * ON CONFLICT `(event_id, steam_id)` display columns. A row with a Discord
 * identity (merged) keeps its Discord name. Otherwise a linked incoming
 * player's RL identity wins; a row already tied to a user is never renamed
 * to a character name; an unlinked row takes the latest character name.
 * The character name is the incoming one, even when null (ROK-1822 r2): a
 * nameless rejoin may be a different character, so keeping the old name
 * would rehydrate it under that name and pair the next character line to
 * another player. `renameSteamOnlyRow` records the name when the line lands.
 */
export function steamConflictDisplaySet(): {
  discordUsername: SQL;
  characterName: SQL;
  characterOwnerId: SQL;
} {
  const takeIncoming = sql`${t.discordUserId} IS NULL AND (excluded.user_id IS NOT NULL OR ${t.userId} IS NULL)`;
  return {
    discordUsername: sql`CASE WHEN ${takeIncoming} THEN excluded.discord_username ELSE ${t.discordUsername} END`,
    characterName: sql`excluded.character_name`,
    characterOwnerId: sql`excluded.character_owner_id`,
  };
}
