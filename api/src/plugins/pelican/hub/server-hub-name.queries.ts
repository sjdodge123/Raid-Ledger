import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';

/**
 * ROK-1950 D5: a server hub's source name — its Pelican server's name, cut to
 * the hub-name width (64). Null when the hub is not linked to a server (the
 * server was deleted, `pelican_server_id` set null) or the hub is missing.
 */
export async function loadServerHubSourceName(
  db: PostgresJsDatabase<typeof schema>,
  guildId: number,
): Promise<string | null> {
  const g = schema.guilds;
  const s = schema.pelicanServers;
  const [row] = await db
    .select({ name: s.name })
    .from(g)
    .innerJoin(s, eq(s.id, g.pelicanServerId))
    .where(eq(g.id, guildId))
    .limit(1);
  return row ? row.name.slice(0, 64) : null;
}
