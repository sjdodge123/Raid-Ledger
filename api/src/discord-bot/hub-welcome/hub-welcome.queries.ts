/**
 * ROK-1933 Part 4 — the hub facts and stored welcome ids `HubWelcomeService`
 * reads, plus the id writes. Ids live on `guild_profiles` (D10).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Everything the welcome flow needs about one hub. */
export interface HubWelcomeTarget {
  guildId: number;
  name: string;
  kind: string;
  gameSlug: string | null;
  /** The channel currently bound (as this connection sees it). */
  boundChannelId: string | null;
  welcomeChannelId: string | null;
  welcomeMessageId: string | null;
}

/**
 * Load the hub, its game slug and its stored welcome ids; null when the hub
 * does not exist.
 *
 * @param db - Drizzle handle.
 * @param guildId - Hub (guild) id.
 */
export async function findWelcomeTarget(
  db: Db,
  guildId: number,
): Promise<HubWelcomeTarget | null> {
  const [row] = await db
    .select({
      guildId: schema.guilds.id,
      name: schema.guilds.name,
      kind: schema.guilds.kind,
      gameSlug: schema.games.slug,
      boundChannelId: schema.guildProfiles.discordChannelId,
      welcomeChannelId: schema.guildProfiles.welcomeChannelId,
      welcomeMessageId: schema.guildProfiles.welcomeMessageId,
    })
    .from(schema.guilds)
    .leftJoin(schema.games, eq(schema.games.id, schema.guilds.gameId))
    .leftJoin(
      schema.guildProfiles,
      eq(schema.guildProfiles.guildId, schema.guilds.id),
    )
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  return row ?? null;
}

/**
 * Store (or overwrite) where the welcome lives. An upsert: the auto-link path
 * may announce a hub whose profile row is not visible yet.
 */
export async function saveWelcome(
  db: Db,
  guildId: number,
  channelId: string,
  messageId: string,
): Promise<void> {
  const set = { welcomeChannelId: channelId, welcomeMessageId: messageId };
  await db
    .insert(schema.guildProfiles)
    .values({ guildId, ...set })
    .onConflictDoUpdate({ target: schema.guildProfiles.guildId, set });
}

/** Forget the welcome (it was deleted, or is gone). */
export async function clearWelcome(db: Db, guildId: number): Promise<void> {
  await db
    .update(schema.guildProfiles)
    .set({ welcomeChannelId: null, welcomeMessageId: null })
    .where(eq(schema.guildProfiles.guildId, guildId));
}
