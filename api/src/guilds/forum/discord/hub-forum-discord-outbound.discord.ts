import { Injectable } from '@nestjs/common';
import {
  ChannelType,
  DiscordAPIError,
  type ActionRowBuilder,
  type ButtonBuilder,
  type EmbedBuilder,
  type Guild,
  type ThreadChannel,
  type Webhook,
} from 'discord.js';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { removePostMembers } from './hub-forum-discord-post-members';
import { postTagIds, type ForumTag } from './hub-forum-discord-decor';
import { HubForumDiscordRouteResolver } from './hub-forum-discord-route';
import type { SubjectKind } from './hub-forum-discord-subject';

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

/** ROK-2292: the event card a post's starter is edited to. */
export interface StarterCard {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
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
  constructor(
    private readonly client: DiscordBotClientService,
    private readonly routes: HubForumDiscordRouteResolver,
  ) {}

  /** A new forum post; returns the post (thread) and starter message ids. */
  async createPost(
    target: OutboundTarget,
    post: {
      title: string;
      content: string;
      tagIds: string[];
      kind?: SubjectKind;
    },
    author: OutboundAuthor,
  ): Promise<DiscordMessageRef> {
    const hook = await this.webhook(target);
    const kind = post.kind ?? null;
    const forumTags = this.cachedForumTags(target.channelId);
    const hubTags = kind === null ? [] : await this.hubTagIds(target.channelId);
    const msg = await hook.send({
      ...identity(author),
      threadName: post.title,
      content: post.content,
      // ROK-2258 / ROK-2272 S8: a subject post also carries its kind tag.
      appliedTags: postTagIds(post.tagIds, kind, forumTags, hubTags),
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
   * ROK-2292 D4/D5 — edit a post's starter message to the event card,
   * content `''`. A webhook starter (hub post) is edited through that
   * webhook, a bot starter (planning post) by the bot: Discord rejects the
   * bot editing a webhook's message (50005).
   */
  async editStarterCard(
    threadId: string,
    card: StarterCard,
  ): Promise<DiscordWriteResult> {
    try {
      const thread = await this.thread(threadId);
      const starter = await thread.fetchStarterMessage();
      if (!starter) return 'gone';
      const body = { content: '', ...card, allowedMentions: NO_MENTIONS };
      if (!starter.webhookId) {
        await starter.edit(body);
        return 'ok';
      }
      const forum = thread.parentId;
      if (!forum) throw new Error(`Discord post ${threadId} has no forum`);
      const hook = await this.webhook({
        channelId: forum,
        webhookId: starter.webhookId,
      });
      await hook.editMessage(starter.id, { ...body, threadId });
      return 'ok';
    } catch (err) {
      if (isGone(err)) return 'gone';
      throw err;
    }
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

  /** ROK-2260: the bot is connected to its guild (else a flush waits). */
  isOnline(): boolean {
    return this.client.isConnected() && this.client.getGuild() !== null;
  }

  /**
   * ROK-2260: a bot message in a post that pings exactly `userIds` — the
   * mention is what adds each of them to the post (Discord thread rule).
   */
  async mention(
    discordThreadId: string,
    content: string,
    userIds: string[],
  ): Promise<void> {
    const thread = await this.thread(discordThreadId);
    await thread.send({ content, allowedMentions: { users: userIds } });
  }

  /**
   * ROK-2260 ruling 3: silently take users out of a post (reopening an
   * auto-archived one first). Returns the ids that are out of it. Reads the
   * post fresh (review r2-1): a ping in the same flush unarchives it, and a
   * stale cached `archived` would re-archive the post just pinged in.
   */
  async removeThreadMembers(
    discordThreadId: string,
    userIds: string[],
    warn: (message: string) => void,
  ): Promise<string[]> {
    const thread = await this.thread(discordThreadId, true);
    return removePostMembers(thread, userIds, warn);
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

  /** `force` skips the cache — only where a stale field would mislead. */
  private async thread(id: string, force = false): Promise<ThreadChannel> {
    const ch = await this.guild().channels.fetch(id, { force });
    if (!ch?.isThread()) throw new Error(`Discord post ${id} is not a thread`);
    return ch;
  }

  /** The forum's tags from the cache (`webhook` just fetched it). */
  /** Tags the forum's bound hubs own (never a kind tag, Codex P2). */
  private async hubTagIds(channelId: string): Promise<(string | null)[]> {
    const route = await this.routes.resolve(channelId);
    return route?.bindings.map((b) => b.tagId) ?? [];
  }

  private cachedForumTags(channelId: string): ForumTag[] {
    const ch = this.guild().channels.cache.get(channelId);
    if (ch?.type !== ChannelType.GuildForum) return [];
    return ch.availableTags.map((t) => ({ id: t.id, name: t.name }));
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
