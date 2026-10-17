import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/**
 * ROK-1788 — the Discord channel binding on `guild_profiles` (no access
 * logic). Only WHICH channel is stored; message content never is.
 */

type Db = PostgresJsDatabase<typeof schema>;

const { guildProfiles, users } = schema;

export interface ChannelBinding {
  channelId: string;
  privateAck: boolean;
  setBy: number;
  setAt: Date;
}

/** The bound channel id, or null when none (or no profile row). */
export async function findBoundChannelId(
  db: Db,
  guildId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ channelId: guildProfiles.discordChannelId })
    .from(guildProfiles)
    .where(eq(guildProfiles.guildId, guildId))
    .limit(1);
  return row?.channelId ?? null;
}

/** The bound channel and whether a private-channel ack is on record, or null. */
export async function findBinding(
  db: Db,
  guildId: number,
): Promise<{ channelId: string; privateAck: boolean } | null> {
  const [row] = await db
    .select({
      channelId: guildProfiles.discordChannelId,
      privateAck: guildProfiles.discordChannelPrivateAck,
    })
    .from(guildProfiles)
    .where(eq(guildProfiles.guildId, guildId))
    .limit(1);
  if (!row?.channelId) return null;
  return { channelId: row.channelId, privateAck: row.privateAck };
}

/** Insert-or-update the binding columns only. */
export async function saveBinding(
  db: Db,
  guildId: number,
  binding: ChannelBinding,
): Promise<void> {
  const set = {
    discordChannelId: binding.channelId,
    discordChannelPrivateAck: binding.privateAck,
    discordChannelSetBy: binding.setBy,
    discordChannelSetAt: binding.setAt,
  };
  await db
    .insert(guildProfiles)
    .values({ guildId, ...set })
    .onConflictDoUpdate({ target: guildProfiles.guildId, set });
}

/** Reset the 4 binding columns (no-op without a profile row). */
export async function clearBinding(db: Db, guildId: number): Promise<void> {
  await db
    .update(guildProfiles)
    .set({
      discordChannelId: null,
      discordChannelPrivateAck: false,
      discordChannelSetBy: null,
      discordChannelSetAt: null,
    })
    .where(eq(guildProfiles.guildId, guildId));
}

/** The user's stored `discord_id` (may be a `local:` placeholder). */
export async function findDiscordId(
  db: Db,
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ discordId: users.discordId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.discordId ?? null;
}
