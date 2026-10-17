import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind, GuildSummary } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/** ROK-1830 — game-agnostic guild reads shared by core and every hub kind. */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds } = schema;

export async function findGuild(
  db: Db,
  guildId: number,
): Promise<schema.GuildSelect | null> {
  const [row] = await db
    .select()
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1);
  return row ?? null;
}

/** The guild's hub kind, or null when the guild does not exist. */
export async function findGuildKind(
  db: Db,
  guildId: number,
): Promise<GuildKind | null> {
  const [row] = await db
    .select({ kind: guilds.kind })
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1);
  return row?.kind ?? null;
}

/** Row shape → contract `GuildSummary` (ISO timestamps). */
export function toGuildSummary(row: schema.GuildSelect): GuildSummary {
  return {
    id: row.id,
    gameId: row.gameId,
    kind: row.kind,
    name: row.name,
    region: row.region,
    realmSlug: row.realmSlug,
    realmName: row.rawRealm,
    faction: row.faction,
    memberCount: row.memberCount,
    lastSnapshotAt: row.lastSnapshotAt?.toISOString() ?? null,
  };
}
