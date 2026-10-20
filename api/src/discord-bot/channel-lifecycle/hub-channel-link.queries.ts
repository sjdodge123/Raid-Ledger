/**
 * ROK-1871 (ROK-1428 §2.7, D7) — hub auto-link SQL. A hub of the game whose
 * `guild_profiles.discord_channel_id` is NULL gets the managed channel with
 * `discord_channel_source = 'auto'`; a Leader's set or clear (`'manual'`) is
 * never overwritten. Only {@link HUB_LINK_KINDS} are linked (OQ-3: WoW
 * guild hubs never are).
 */
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { GuildDiscordManagedForDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { HUB_LINK_KINDS } from './hub-link.resolver';

type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
type ChannelSource = 'auto' | 'manual';

const { guilds, guildProfiles, channelBindings, games } = schema;

/** The managed-channel binding purpose (the lifecycle's only candidate). */
const MANAGED_PURPOSE = 'game-announcements';

/** A hub's current channel state (null source = no profile / never set). */
export interface HubChannelState {
  channelId: string | null;
  source: ChannelSource | null;
}

/** D7: only a channel-less hub that no Leader set or cleared is linkable. */
export function isAutoLinkable(state: HubChannelState): boolean {
  return state.channelId === null && state.source !== 'manual';
}

/** SQL twin of {@link isAutoLinkable} over the left-joined profile. */
function linkableProfileWhere(): SQL {
  const { discordChannelId: channel, discordChannelSource: source } =
    guildProfiles;
  return sql`(${channel} IS NULL AND (${source} IS NULL OR ${source} = 'auto'))`;
}

/** Visible hubs of an auto-linkable kind (optionally for one game). */
function eligibleHubsWhere(gameId?: number): SQL | undefined {
  return and(
    inArray(guilds.kind, [...HUB_LINK_KINDS]),
    isNull(guilds.hiddenAt),
    gameId === undefined ? undefined : eq(guilds.gameId, gameId),
    linkableProfileWhere(),
  );
}

/** Eligible, channel-less hub ids for a game. */
async function selectLinkableHubIds(db: Db, gameId: number): Promise<number[]> {
  const rows = await db
    .select({ id: guilds.id })
    .from(guilds)
    .leftJoin(guildProfiles, eq(guildProfiles.guildId, guilds.id))
    .where(eligibleHubsWhere(gameId));
  return rows.map((r) => r.id);
}

/**
 * Link every eligible channel-less hub of the game to `channelId`. The
 * conflict `setWhere` re-checks D7 so a racing Leader write is never
 * overwritten.
 *
 * @returns how many hub profiles were linked
 */
export async function linkHubsForGame(
  db: Db,
  gameId: number,
  channelId: string,
): Promise<number> {
  const ids = await selectLinkableHubIds(db, gameId);
  if (ids.length === 0) return 0;
  const set = {
    discordChannelId: channelId,
    discordChannelSource: 'auto' as const,
    discordChannelPrivateAck: false,
    discordChannelSetBy: null,
    discordChannelSetAt: new Date(),
  };
  const linked = await db
    .insert(guildProfiles)
    .values(ids.map((guildId) => ({ guildId, ...set })))
    .onConflictDoUpdate({
      target: guildProfiles.guildId,
      set,
      setWhere: linkableProfileWhere(),
    })
    .returning({ guildId: guildProfiles.guildId });
  return linked.length;
}

/** Game ids that have an eligible hub still lacking a channel (L3 seam). */
export async function selectHubNeedsLinkGameIds(db: Db): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ gameId: guilds.gameId })
    .from(guilds)
    .leftJoin(guildProfiles, eq(guildProfiles.guildId, guilds.id))
    .where(eligibleHubsWhere());
  return new Set(rows.map((r) => r.gameId));
}

/** The game a lifecycle-managed channel belongs to, or null. */
export async function findManagedForChannel(
  db: Db,
  channelId: string,
): Promise<GuildDiscordManagedForDto | null> {
  const [row] = await db
    .select({ gameId: games.id, gameName: games.name })
    .from(channelBindings)
    .innerJoin(games, eq(games.id, channelBindings.gameId))
    .where(
      and(
        eq(channelBindings.channelId, channelId),
        eq(channelBindings.autoManaged, true),
        eq(channelBindings.bindingPurpose, MANAGED_PURPOSE),
        sql`${channelBindings.recurrenceGroupId} IS NULL`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * A managed channel was deleted in Discord (10003): clear it from every hub
 * the lifecycle AUTO-linked to it. Manual links are the Leader's and stay.
 *
 * @returns How many hubs were unlinked.
 */
export async function unlinkAutoHubsForChannel(
  db: Db,
  channelId: string,
): Promise<number> {
  const gp = schema.guildProfiles;
  const rows = await db
    .update(gp)
    .set({ discordChannelId: null, discordChannelSource: null })
    .where(
      and(
        eq(gp.discordChannelId, channelId),
        eq(gp.discordChannelSource, 'auto'),
      ),
    )
    .returning({ guildId: gp.guildId });
  return rows.length;
}
