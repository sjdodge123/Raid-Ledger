/**
 * ROK-2232 / ROK-2298 — SteamID → linked RL identity for Quick Play presence.
 * Split from `ad-hoc-server-presence.helpers.ts` (which re-exports it).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  steamIdOf,
  type PlayerRef,
} from '../../plugins/pelican/presence/presence-events';

type Db = PostgresJsDatabase<typeof schema>;

export interface SteamIdentity {
  userId: number;
  discordId: string | null;
  /** The RL name a linked player shows as: `display_name`, else `username`. */
  displayName: string;
}

/**
 * SteamID64 → the linked RL user (`users.steam_id`), if any. ROK-2298 (Q7): a
 * banned or deactivated account resolves null, so the player shows as an
 * anonymous SteamID like an unlinked one and is never a DM target.
 */
export async function resolveSteamIdentity(
  db: Db,
  steamId: string,
): Promise<SteamIdentity | null> {
  const u = schema.users;
  const rows = await db
    .select({
      userId: u.id,
      discordId: u.discordId,
      displayName: sql<string>`coalesce(${u.displayName}, ${u.username})`,
    })
    .from(u)
    .where(
      sql`${u.steamId} = ${steamId} and ${u.bannedAt} is null and ${u.deactivatedAt} is null`,
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * ROK-2232: a player's linked RL user — Steam only (`users.steam_id`); any
 * other id kind stays anonymous until a claim exists.
 */
export function resolvePlayerIdentity(
  db: Db,
  player: PlayerRef,
): Promise<SteamIdentity | null> {
  const steamId = steamIdOf(player);
  return steamId === null
    ? Promise.resolve(null)
    : resolveSteamIdentity(db, steamId);
}
