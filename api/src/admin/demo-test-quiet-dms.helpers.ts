/**
 * `quietDms` support for the DEMO_MODE `seed-non-guild-user` fixture.
 *
 * The seeded member carries a real-shaped Discord snowflake that is NOT in the
 * test guild. On a fleet env the bot is live, so any DM a concurrent spec fans
 * out to it (e.g. `lineup_steam_nudge` on `POST /lineups`, or a
 * `community_lineup` DM) fails with 10013/50278 and the notification processor
 * deactivates the member mid-run. Specs that need the member to stay ACTIVE
 * (the admin moderation smoke) opt in to `quietDms`, which stores a prefs row
 * with Discord OFF for every notification type.
 *
 * Why prefs cover every deactivating path: the only code that deactivates on a
 * DM failure is the discord-notification queue processor, and the only
 * producers of that queue (besides the DEMO_MODE `dispatch-discord-notification`
 * probe) are `DiscordNotificationService.dispatch` (`isTypeDisabledForUser`)
 * and `dispatchMany` (`loadDisabledTypes`) — both honour the stored
 * `channelPrefs[type].discord === false`.
 */
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_CHANNEL_PREFS,
  NOTIFICATION_TYPES,
  type ChannelPrefs,
} from '../drizzle/schema/notification-preferences';

/** Parse the optional `quietDms` body flag; absent → false, non-boolean → 400. */
export function parseQuietDms(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const value = (body as { quietDms?: unknown }).quietDms;
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new BadRequestException('quietDms must be a boolean');
  }
  return value;
}

/** Default channel matrix with the Discord channel OFF for every type. */
export function buildQuietDmChannelPrefs(): ChannelPrefs {
  const prefs = {} as ChannelPrefs;
  for (const type of NOTIFICATION_TYPES) {
    prefs[type] = { ...DEFAULT_CHANNEL_PREFS[type], discord: false };
  }
  return prefs;
}

/** Upsert the user's prefs row so no Discord DM is ever enqueued for them. */
export async function muteDiscordDms(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<void> {
  const channelPrefs = buildQuietDmChannelPrefs();
  await db
    .insert(schema.userNotificationPreferences)
    .values({ userId, channelPrefs })
    .onConflictDoUpdate({
      target: schema.userNotificationPreferences.userId,
      set: { channelPrefs },
    });
}
