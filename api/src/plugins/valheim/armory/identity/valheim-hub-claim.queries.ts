/** ROK-2153 S4 — the two reads the Valheim claim provider adds. */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import type { ValheimClaimViewer } from './valheim-hub-claim.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The Pelican server a `game_server` hub is keyed to, or null. */
export async function findHubServerId(
  db: Db,
  guildId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ serverId: schema.guilds.pelicanServerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  return row?.serverId ?? null;
}

/** The viewer's names and verified SteamID64 (empty when the user is gone). */
export async function findViewerFacts(
  db: Db,
  userId: number,
): Promise<ValheimClaimViewer> {
  const [row] = await db
    .select({
      username: schema.users.username,
      displayName: schema.users.displayName,
      steamId: schema.users.steamId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) return { names: [], steamId: null };
  const names = [row.username, row.displayName].filter(
    (n): n is string => typeof n === 'string' && n !== '',
  );
  return { names, steamId: row.steamId };
}
