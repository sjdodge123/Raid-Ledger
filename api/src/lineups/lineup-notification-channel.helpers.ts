/**
 * Resolves the Discord channel for lineup embeds (ROK-932, ROK-1064).
 *
 * Priority:
 *   1. Per-lineup channel override (ROK-1064) — if set AND the bot currently
 *      has ViewChannel + SendMessages + EmbedLinks on that channel.
 *   2. Admin-configured lineup channel.
 *   3. Default announcement channel.
 *   4. null.
 *
 * Fallback behavior (ROK-1064):
 *   When an override is set but the bot lacks required permissions (or the
 *   channel is missing from the guild cache), we WARN once per
 *   `(lineupId, channelId)` pair via the dedup service and fall through to
 *   the existing chain. The DB row is never mutated.
 */
import { eq } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { PermissionsBitField } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DEDUP_TTL } from './lineup-notification.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** Lineup metadata pulled from the DB for embed context (ROK-1063). */
export interface LineupMeta {
  title?: string;
  description?: string | null;
}

/** Load title + description for a lineup (ROK-1063). */
export async function loadLineupMeta(
  db: Db,
  lineupId: number,
): Promise<LineupMeta> {
  const [row] = await db
    .select({
      title: schema.communityLineups.title,
      description: schema.communityLineups.description,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  return { title: row?.title, description: row?.description ?? null };
}

/** Load the configured channel override for a lineup (ROK-1064). */
export async function loadLineupChannelOverride(
  db: Db,
  lineupId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ channelOverrideId: schema.communityLineups.channelOverrideId })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  return row?.channelOverrideId ?? null;
}

/** Module-local logger so the warn call is easy to spy in tests. */
const logger = new Logger('LineupNotificationChannel');

/** Required permission flags for posting a lineup embed (ROK-1064). */
const REQUIRED_FLAGS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
] as const;

/** Check whether the bot currently has post permissions on a channel. */
function hasPostPermissions(
  botClient: DiscordBotClientService,
  channelId: string,
): boolean {
  const guild = botClient.getGuild();
  if (!guild) return false;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return false;
  if (typeof channel.isTextBased === 'function' && !channel.isTextBased())
    return false;
  if (typeof channel.isDMBased === 'function' && channel.isDMBased())
    return false;
  if (
    'isThread' in channel &&
    typeof (channel as { isThread?: () => boolean }).isThread === 'function' &&
    (channel as { isThread: () => boolean }).isThread()
  ) {
    return false;
  }

  const me = guild.members?.me;
  if (!me) return false;

  // Prefer channel.permissionsFor(me) when available; fall back to permissionsIn.
  if (typeof channel.permissionsFor === 'function') {
    const perms = channel.permissionsFor(me);
    if (!perms) return false;
    return perms.has([...REQUIRED_FLAGS]);
  }
  if (typeof me.permissionsIn === 'function') {
    const perms = me.permissionsIn(
      channel as unknown as Parameters<typeof me.permissionsIn>[0],
    );
    if (!perms) return false;
    return perms.has([...REQUIRED_FLAGS]);
  }
  return false;
}

/** Fall back to the existing settings-based chain. */
async function resolveSettingsChannel(
  settingsService: SettingsService,
): Promise<string | null> {
  const lineupChannel = await settingsService.get(
    SETTING_KEYS.DISCORD_BOT_LINEUP_CHANNEL,
  );
  if (lineupChannel) return lineupChannel;
  return settingsService.getDiscordBotDefaultChannel();
}

/** Warn once per (lineupId, channelId) pair about a fallback (ROK-1064). */
async function warnOverrideFallback(
  dedupService: NotificationDedupService,
  lineupId: number,
  overrideId: string,
): Promise<void> {
  const dedupKey = `lineup-override-fallback:${lineupId}:${overrideId}`;
  const alreadyWarned = await dedupService.checkAndMarkSent(
    dedupKey,
    DEDUP_TTL,
  );
  if (alreadyWarned) return;
  logger.warn(
    `Lineup ${lineupId}: bot lacks post permissions on override channel ${overrideId}; falling back to bound channel.`,
  );
}

/**
 * Resolve the channel ID for posting lineup embeds (ROK-1064).
 *
 * @param settingsService - Application settings service
 * @param botClient - Discord bot client (guild/channel cache)
 * @param dedupService - Dedup guard for warn-once semantics
 * @param lineupId - Lineup whose embed is being dispatched
 * @param overrideId - Optional per-lineup channel override (Discord snowflake)
 * @returns Resolved channel ID, or null if nothing is configured
 */
export async function resolveLineupChannel(
  settingsService: SettingsService,
  botClient: DiscordBotClientService,
  dedupService: NotificationDedupService,
  lineupId: number,
  overrideId: string | null | undefined,
): Promise<string | null> {
  if (overrideId) {
    if (hasPostPermissions(botClient, overrideId)) return overrideId;
    await warnOverrideFallback(dedupService, lineupId, overrideId);
  }
  return resolveSettingsChannel(settingsService);
}
