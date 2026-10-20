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

/** The fields the visitor Overview read checks (ROK-1870 D14). */
export interface GuildVisibility {
  kind: GuildKind;
  status: schema.GuildSelect['status'];
  hiddenAt: Date | null;
}

/** The guild's kind/status/hidden stamp, or null when it does not exist. */
export async function findGuildVisibility(
  db: Db,
  guildId: number,
): Promise<GuildVisibility | null> {
  const [row] = await db
    .select({
      kind: guilds.kind,
      status: guilds.status,
      hiddenAt: guilds.hiddenAt,
    })
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1);
  return row ?? null;
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

/**
 * ROK-1831 L-5: the summary a hub page sends — staff also get `hidden` so the
 * settings Hide switch reflects (and can clear) `hidden_at`. Non-staff never
 * reach a hidden hub, so the flag is omitted for them.
 */
export function hubSummaryFor(
  row: schema.GuildSelect,
  staff: boolean,
): GuildSummary {
  const summary = toGuildSummary(row);
  return staff ? { ...summary, hidden: row.hiddenAt !== null } : summary;
}
