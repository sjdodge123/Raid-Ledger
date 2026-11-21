/**
 * ROK-2272 S4a §3.9 — the Discord writes behind Discord-only posts in the
 * event-planning forum. These posts are made BY THE BOT (no webhook, unlike
 * hub posts), so they do not go through `HubForumDiscordOutboundGateway`'s
 * webhook `createPost`. Plain data in and out so specs can spy on it.
 * Throws when the bot is offline (like the outbound gateway); a Discord 404
 * on rename/delete is `'gone'`.
 */
import { Injectable } from '@nestjs/common';
import { ChannelType, type Guild, type ThreadChannel } from 'discord.js';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import type { ForumStarterCard } from '../../../discord-bot/services/event-embed-message.editor';
import {
  isGone,
  type DiscordWriteResult,
} from './hub-forum-discord-outbound.discord';

const REASON = 'Raid Ledger event-planning post';
const NO_MENTIONS = { parse: [] };

/** A new Discord-only post. */
export interface PlanningPostDraft {
  title: string;
  content: string;
  tagIds: string[];
  /** ROK-2292 D2: an event post opens with its signup card instead. */
  card?: ForumStarterCard;
}

/** The card (content `''`) when there is one, else the text starter. */
function starterMessage(post: PlanningPostDraft) {
  if (!post.card) return { content: post.content };
  const { embeds, components } = post.card;
  return { content: '', embeds, components };
}

@Injectable()
export class EventPlanningPostsGateway {
  constructor(private readonly client: DiscordBotClientService) {}

  /** The bot is connected to its guild. */
  isOnline(): boolean {
    return this.client.isConnected() && this.client.getGuild() !== null;
  }

  /** Create a bot-posted forum thread; returns its (thread) id. */
  async createPost(
    channelId: string,
    post: PlanningPostDraft,
  ): Promise<string> {
    const ch = await this.guild().channels.fetch(channelId);
    if (ch?.type !== ChannelType.GuildForum) {
      throw new Error(`Forum ${channelId} is gone`);
    }
    const thread = await ch.threads.create({
      name: post.title,
      message: { ...starterMessage(post), allowedMentions: NO_MENTIONS },
      appliedTags: post.tagIds,
      reason: REASON,
    });
    return thread.id;
  }

  /** Rename the post when its name differs. */
  async renameThread(
    discordThreadId: string,
    name: string,
  ): Promise<DiscordWriteResult> {
    return this.orGone(async () => {
      const thread = await this.thread(discordThreadId);
      if (thread.name !== name) await thread.setName(name, REASON);
    });
  }

  /** Delete the whole post. */
  async deleteThread(discordThreadId: string): Promise<DiscordWriteResult> {
    return this.orGone(async () => {
      const thread = await this.thread(discordThreadId);
      await thread.delete(REASON);
    });
  }

  private async orGone(fn: () => Promise<void>): Promise<DiscordWriteResult> {
    try {
      await fn();
      return 'ok';
    } catch (err) {
      if (isGone(err)) return 'gone';
      throw err;
    }
  }

  private guild(): Guild {
    const guild = this.client.isConnected() ? this.client.getGuild() : null;
    if (!guild) throw new Error('Discord bot is offline');
    return guild;
  }

  private async thread(id: string): Promise<ThreadChannel> {
    const ch = await this.guild().channels.fetch(id);
    if (!ch?.isThread()) throw new Error(`Discord post ${id} is not a thread`);
    return ch;
  }
}
