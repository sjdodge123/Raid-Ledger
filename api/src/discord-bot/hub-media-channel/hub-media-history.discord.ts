import { Injectable } from '@nestjs/common';
import { findTextChannel } from '../channel-mirror/channel-mirror.discord';
import { DiscordBotClientService } from '../discord-bot-client.service';
import type { PostLike } from './hub-media-post.images';
import { toPostLike } from './hub-media-post.mapper';

/** Discord's `messages.fetch` page size cap; the backfill pages at it. */
export const HISTORY_PAGE_SIZE = 100;

/**
 * ROK-1941 D12 — one channel's history, newest first, a page of up to
 * {@link HISTORY_PAGE_SIZE} older than `before` (none = the newest). An empty
 * page is the end of the channel. Specs stub it; nothing else reads Discord.
 */
export interface HistoryPort {
  fetchBefore(before?: string): Promise<PostLike[]>;
}

/** Opens the real {@link HistoryPort} for a bound channel. */
@Injectable()
export class HubMediaHistorySource {
  constructor(private readonly client: DiscordBotClientService) {}

  /** The channel's port, or null when the bot is offline or cannot see it. */
  open(channelId: string): HistoryPort | null {
    const guild = this.client.getGuild();
    const channel = guild ? findTextChannel(guild, channelId) : null;
    if (!channel) return null;
    return {
      fetchBefore: async (before) => {
        const page = await channel.messages.fetch({
          limit: HISTORY_PAGE_SIZE,
          ...(before === undefined ? {} : { before }),
        });
        return [...page.values()].map(toPostLike);
      },
    };
  }
}
