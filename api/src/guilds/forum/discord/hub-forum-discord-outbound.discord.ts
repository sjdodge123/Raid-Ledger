import { Injectable } from '@nestjs/common';
import {
  ChannelType,
  DiscordAPIError,
  type Guild,
  type ThreadChannel,
  type Webhook,
} from 'discord.js';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';

/** The bound forum and its one webhook (R9). */
export interface OutboundTarget {
  channelId: string;
  webhookId: string;
}

/** Who the webhook posts as (§5.2). */
export interface OutboundAuthor {
  username: string;
  avatarURL: string | null;
}

/** A Discord message inside a forum post. */
export interface DiscordMessageRef {
  threadId: string;
  messageId: string;
}

/** `gone`: Discord 404 — the message/post no longer exists (mark synced). */
export type DiscordWriteResult = 'ok' | 'gone';

const REASON = 'Raid Ledger hub forum sync';
const NO_MENTIONS = { parse: [] };
/** Unknown Channel, Unknown Message, Unknown Webhook. */
const GONE_CODES = new Set<number | string>([10003, 10008, 10015]);

/** Discord says the target no longer exists. */
export function isGone(err: unknown): boolean {
  if (!(err instanceof DiscordAPIError)) return false;
  return err.status === 404 || GONE_CODES.has(err.code);
}

async function orGone(fn: () => Promise<unknown>): Promise<DiscordWriteResult> {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    if (isGone(err)) return 'gone';
    throw err;
  }
}

function identity(author: OutboundAuthor) {
  const { username, avatarURL } = author;
  return avatarURL ? { username, avatarURL } : { username };
}

/**
 * ROK-2208 §5.2 — every outbound Discord call (webhook send/edit, bot
 * rename/delete) behind plain data, so the sync service and its integration
 * spec never handle discord.js objects. Throws on failure except a 404,
 * which is `'gone'`.
 */
@Injectable()
export class HubForumDiscordOutboundGateway {
  constructor(private readonly client: DiscordBotClientService) {}

  /** A new forum post; returns the post (thread) and starter message ids. */
  async createPost(
    target: OutboundTarget,
    post: { title: string; content: string; tagIds: string[] },
    author: OutboundAuthor,
  ): Promise<DiscordMessageRef> {
    const hook = await this.webhook(target);
    const msg = await hook.send({
      ...identity(author),
      threadName: post.title,
      content: post.content,
      appliedTags: post.tagIds,
      allowedMentions: NO_MENTIONS,
    });
    return { threadId: msg.channelId, messageId: msg.id };
  }

  /** A reply inside an existing post; returns the message id. */
  async createReply(
    target: OutboundTarget,
    discordThreadId: string,
    content: string,
    author: OutboundAuthor,
  ): Promise<string> {
    const hook = await this.webhook(target);
    const msg = await hook.send({
      ...identity(author),
      threadId: discordThreadId,
      content,
      allowedMentions: NO_MENTIONS,
    });
    return msg.id;
  }

  /** Edit a message our webhook sent. */
  async editMessage(
    target: OutboundTarget,
    ref: DiscordMessageRef,
    content: string,
  ): Promise<DiscordWriteResult> {
    return orGone(async () => {
      const hook = await this.webhook(target);
      await hook.editMessage(ref.messageId, {
        content,
        threadId: ref.threadId,
        allowedMentions: NO_MENTIONS,
      });
    });
  }

  /**
   * Rename a post when its name differs; `spend` is asked only then (the
   * 2-renames-per-10-min budget) and a refusal throws so the row retries.
   */
  async renameThread(
    discordThreadId: string,
    name: string,
    spend: () => boolean,
  ): Promise<DiscordWriteResult> {
    return orGone(async () => {
      const thread = await this.thread(discordThreadId);
      if (thread.name === name) return;
      if (!spend()) throw new Error('Thread rename budget spent; retry later');
      await thread.setName(name, REASON);
    });
  }

  /** R4: delete the whole forum post (bot; any origin). */
  async deleteThread(discordThreadId: string): Promise<DiscordWriteResult> {
    return orGone(async () => {
      const thread = await this.thread(discordThreadId);
      await thread.delete(REASON);
    });
  }

  /** OQ-4: a plain bot message inside a post (never pings anyone). */
  async postNotice(discordThreadId: string, content: string): Promise<void> {
    const thread = await this.thread(discordThreadId);
    await thread.send({ content, allowedMentions: NO_MENTIONS });
  }

  /** Delete one message (bot, Manage Messages — §5.3 covers both origins). */
  async deleteMessage(ref: DiscordMessageRef): Promise<DiscordWriteResult> {
    return orGone(async () => {
      const thread = await this.thread(ref.threadId);
      await thread.messages.delete(ref.messageId);
    });
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

  /** The forum's webhook, token included (OQ-9: re-fetched, never stored). */
  private async webhook(target: OutboundTarget): Promise<Webhook> {
    const ch = await this.guild().channels.fetch(target.channelId);
    if (ch?.type !== ChannelType.GuildForum) {
      throw new Error(`Forum ${target.channelId} is gone`);
    }
    const hook = (await ch.fetchWebhooks()).get(target.webhookId);
    if (!hook?.token) throw new Error(`Webhook ${target.webhookId} is gone`);
    return hook;
  }
}
