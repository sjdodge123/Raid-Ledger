/**
 * ROK-1541 — the read behind `GET /admin/test/lfg-board/thread-members`.
 *
 * The companion bot cannot see who is in a thread without the privileged
 * GuildMembers intent, so the smoke asks the API's own bot instead: it is the
 * one that adds and removes the members, so it is the one that can list them.
 */
import type { LfgDb } from '../lfg/lfg-query.helpers';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { findOpenLfmMessage } from '../discord-bot/lfm/lfm-embed.db-helpers';

/** A game's open board post and the Discord ids currently in its thread. */
export interface BoardThreadMembers {
  /** Null when the game has no OPEN forum post. */
  threadId: string | null;
  memberIds: string[];
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
export async function readBoardThreadMembers(
  db: LfgDb,
  client: DiscordBotClientService,
  gameId: number,
): Promise<BoardThreadMembers> {
  const row = await findOpenLfmMessage(db, gameId);
  if (row?.postKind !== 'forum') return { threadId: null, memberIds: [] };
  const threadId = row.threadId ?? row.channelId;
  const guild = client.getGuild();
  if (!guild) return { threadId, memberIds: [] };
  const channel = await guild.channels.fetch(threadId);
  if (!channel?.isThread()) return { threadId, memberIds: [] };
  const members = await channel.members.fetch();
  return { threadId, memberIds: [...members.keys()] };
}
