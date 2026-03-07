/**
 * Guild member helpers for DiscordBotClientService.
 * Extracted from discord-bot-client.service.ts for file size compliance (ROK-719).
 */
import type { Guild } from 'discord.js';
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
