/**
 * Guild member helpers for DiscordBotClientService.
 * Extracted from discord-bot-client.service.ts for file size compliance (ROK-719).
 */
import { ChannelType, type Guild } from 'discord.js';
import { isPerfEnabled, perfLog } from '../common/perf-logger';

/** Search guild members by username query. */
export async function searchGuildMembers(
  guild: Guild | null,
  query: string,
): Promise<{ discordId: string; username: string; avatar: string | null }[]> {
  if (!guild) return [];

  const start = isPerfEnabled() ? performance.now() : 0;
  try {
    const members = await guild.members.fetch({ query, limit: 10 });
    if (start) {
      perfLog('DISCORD', 'searchGuildMembers', performance.now() - start, {
        query,
      });
    }
    return members.map((m) => ({
      discordId: m.user.id,
      username: m.user.username,
      avatar: m.user.avatar,
    }));
  } catch {
    return [];
  }
}

/** List guild members (no query required). */
export async function listGuildMembers(
  guild: Guild | null,
  limit = 25,
): Promise<{ discordId: string; username: string; avatar: string | null }[]> {
  if (!guild) return [];

  try {
    const members = await guild.members.list({ limit });
    return members
      .filter((m) => !m.user.bot)
      .map((m) => ({
        discordId: m.user.id,
        username: m.user.username,
        avatar: m.user.avatar,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  } catch {
    return [];
  }
}

/** Check if a Discord user is in the guild (ROK-403). */
export async function isGuildMember(
  guild: Guild | null,
  discordUserId: string,
): Promise<boolean> {
  if (!guild) return false;

  try {
    const member = await guild.members.fetch(discordUserId);
    return !!member;
  } catch {
    return false;
  }
}

/**
 * Fetch every member of the guild and return their Discord IDs as a Set
 * (ROK-1282). Used by GuildReconciliationService to diff DB users against
 * actual guild membership. Returns null when the bot is disconnected
 * (caller should treat as a no-op, not an error).
 */
export async function listAllGuildMemberIds(
  guild: Guild | null,
): Promise<Set<string> | null> {
  if (!guild) return null;
  const members = await guild.members.fetch();
  return new Set(members.map((m) => m.user.id));
}

/** ROK-1352: List category channels (parents for ephemeral voice channels). */
export function listGuildCategories(
  guild: Guild | null,
): { id: string; name: string }[] {
  if (!guild) return [];
  return guild.channels.cache
    .filter((ch) => ch.type === ChannelType.GuildCategory)
    .map((ch) => ({ id: ch.id, name: ch.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
