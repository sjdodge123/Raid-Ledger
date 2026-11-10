import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { HubClaimHubRef } from '../../plugins/plugin-host/extension-points';

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, games } = schema;

/**
 * ROK-2153: the hub a claim provider is asked about — the guild's kind plus
 * its game's slug and IGDB id in ONE read. Null when the guild does not exist.
 */
export async function findHubClaimRef(
  db: Db,
  guildId: number,
): Promise<HubClaimHubRef | null> {
  const [row] = await db
    .select({
      id: guilds.id,
      kind: guilds.kind,
      gameSlug: games.slug,
      gameIgdbId: games.igdbId,
    })
    .from(guilds)
    .leftJoin(games, eq(games.id, guilds.gameId))
    .where(eq(guilds.id, guildId))
    .limit(1);
  return row ?? null;
}
