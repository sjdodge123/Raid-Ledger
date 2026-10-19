import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { applyCommunityHub } from '../../pelican/hub/server-hub-toggle.helpers';

/**
 * ROK-1837 — find-or-create the map fixture server's ROK-1831 hub through the
 * real "community hub" toggle path, and return its id (DEMO_MODE fixture only).
 */
export async function ensureFixtureHubId(
  db: PostgresJsDatabase<typeof schema>,
  serverId: number,
  gameId: number,
): Promise<number> {
  const S = schema.pelicanServers;
  const G = schema.guilds;
  return db.transaction(async (tx) => {
    const [server] = await tx
      .select({ name: S.name })
      .from(S)
      .where(eq(S.id, serverId))
      .limit(1);
    const name = server?.name ?? `Valheim server ${serverId}`;
    await applyCommunityHub(
      tx,
      { id: serverId, name, gameId },
      true,
      new Date(),
    );
    const [hub] = await tx
      .select({ id: G.id })
      .from(G)
      .where(eq(G.pelicanServerId, serverId))
      .limit(1);
    if (!hub) throw new Error(`map fixture: no hub for server ${serverId}`);
    return hub.id;
  });
}
