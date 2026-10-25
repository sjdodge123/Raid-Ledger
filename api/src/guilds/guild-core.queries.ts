import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind, GuildSummary } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/** ROK-1830 — game-agnostic guild reads shared by core and every hub kind. */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, games } = schema;

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

/** A hub's guild row plus its game's slug (ROK-1909) — what the page builders read. */
export interface HubGuildRow {
  guild: schema.GuildSelect;
  gameSlug: string | null;
}

/**
 * The guild row joined to its game in ONE read, so every hub kind's page can
 * carry `guild.gameSlug` for plugin widgets to gate on (ROK-1909). Null when
 * the guild does not exist.
 */
export async function findHubGuild(
  db: Db,
  guildId: number,
): Promise<HubGuildRow | null> {
  const [row] = await db
    .select({ guild: guilds, gameSlug: games.slug })
    .from(guilds)
    .leftJoin(games, eq(games.id, guilds.gameId))
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
    // ROK-1950 D8: only server hubs have a source name to override.
    ...(row.kind === 'game_server'
      ? { nameOverridden: row.nameOverridden }
      : {}),
  };
}

/**
 * ROK-1831 L-5: the summary a hub page sends — staff also get `hidden` so the
 * settings Hide switch reflects (and can clear) `hidden_at`. Non-staff never
 * reach a hidden hub, so the flag is omitted for them. ROK-1909: also carries
 * the game's slug (`findHubGuild`).
 */
export function hubSummaryFor(hub: HubGuildRow, staff: boolean): GuildSummary {
  const { guild: row, gameSlug } = hub;
  const summary: GuildSummary = {
    ...toGuildSummary(row),
    ...(gameSlug === null ? {} : { gameSlug }),
  };
  return staff ? { ...summary, hidden: row.hiddenAt !== null } : summary;
}
