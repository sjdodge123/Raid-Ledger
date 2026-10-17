/**
 * ROK-1541 — the read behind `GET /admin/test/lfg-board/thread-members`.
 *
 * The companion bot cannot see who is in a thread without the privileged
 * GuildMembers intent, so the smoke asks the API's own bot instead: it is the
 * one that adds and removes the members, so it is the one that can list them.
 */
import { PermissionsBitField } from 'discord.js';
import type { LfgDb } from '../lfg/lfg-query.helpers';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { findOpenLfmMessage } from '../discord-bot/lfm/lfm-embed.db-helpers';

/** A game's open board post and the Discord ids currently in its thread. */
export interface BoardThreadMembers {
  /** Null when the game has no OPEN forum post. */
  threadId: string | null;
  memberIds: string[];
  /**
   * Whether the API bot holds Manage Threads on the post — Discord requires it
   * to REMOVE another member from a public thread, so a smoke that sees a
   * withdrawer stay in the thread can tell a missing grant from a code bug.
   */
  botCanManageThreads: boolean;
  /** Which guild + bot the failing run is actually using (which install to fix). */
  guildId: string | null;
  botUserId: string | null;
}

/**
 * List the thread members of a game's open LFG board post.
 *
 * @param db - Drizzle handle.
 * @param client - The API's Discord bot.
 * @param gameId - Game whose post to read.
 * @returns The post's thread id and its member snowflakes; empty when there is
 *   no open forum post or the bot is offline.
 */
/** The empty read, carrying whatever install context we already resolved. */
function blank(
  threadId: string | null,
  guildId: string | null,
  botUserId: string | null,
): BoardThreadMembers {
  return {
    threadId,
    memberIds: [],
    botCanManageThreads: false,
    guildId,
    botUserId,
  };
}

export async function readBoardThreadMembers(
  db: LfgDb,
  client: DiscordBotClientService,
  gameId: number,
): Promise<BoardThreadMembers> {
  const row = await findOpenLfmMessage(db, gameId);
  if (row?.postKind !== 'forum') return blank(null, null, null);
  const threadId = row.threadId ?? row.channelId;
  const guild = client.getGuild();
  if (!guild) return blank(threadId, null, null);
  const channel = await guild.channels.fetch(threadId);
  const botUserId = guild.members.me?.id ?? null;
  if (!channel?.isThread()) return blank(threadId, guild.id, botUserId);
  const members = await channel.members.fetch();
  const me = guild.members.me;
  const botCanManageThreads = me
    ? (channel
        .permissionsFor(me)
        ?.has(PermissionsBitField.Flags.ManageThreads) ?? false)
    : false;
  return {
    threadId,
    memberIds: [...members.keys()],
    botCanManageThreads,
    guildId: guild.id,
    botUserId,
  };
}
