import type { ForumStarterCard } from '../../../discord-bot/services/event-embed-message.editor';
import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelType,
  DiscordAPIError,
  ThreadAutoArchiveDuration,
  type Guild,
  type ThreadChannel,
  type Webhook,
} from 'discord.js';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { removePostMembers } from './hub-forum-discord-post-members';
import { postTagIds, type ForumTag } from './hub-forum-discord-decor';
import { HubForumDiscordRouteResolver } from './hub-forum-discord-route';
import type { SubjectKind } from './hub-forum-discord-subject';
import { WebhookCache } from './hub-forum-discord-webhook.cache';

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

/**
 * ROK-2292 — who authored a post's starter, from our records: the bot (an
 * event-planning post) or the bound hub's webhook (a hub post). Decided from
 * the DB so an edit needs no `fetchStarterMessage()` GET (review MINOR).
 */
export type StarterAuthor =
  { kind: 'bot' } | { kind: 'webhook'; target: OutboundTarget };

/** The forum or its webhook no longer exists: nothing can ever edit through it. */
export class ForumWebhookGoneError extends Error {}

/** Discord: Thread is archived. */
export const THREAD_ARCHIVED = 50083;

/** True for Discord's "Thread is archived" (an idle post auto-archived). */
export function isArchivedError(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === THREAD_ARCHIVED;
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

/** ROK-2292 D2: an event post opens with its card (content `''`). */
function starterBody(post: { content: string; card?: ForumStarterCard }) {
  if (!post.card) return { content: post.content };
  const { embeds, components } = post.card;
  return { content: '', embeds, components };
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
  private readonly logger = new Logger(HubForumDiscordOutboundGateway.name);
  private readonly starterHooks = new WebhookCache<Webhook>();

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
      /** ROK-2292 D2: an event post opens with its card (content `''`). */
      card?: ForumStarterCard;
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
      ...starterBody(post),
      // ROK-2258 / ROK-2272 S8: a subject post also carries its kind tag.
      appliedTags: postTagIds(post.tagIds, kind, forumTags, hubTags),
      allowedMentions: NO_MENTIONS,
    });
    if (post.card) await this.keepOpenAWeek(msg.channelId);
    return { threadId: msg.channelId, messageId: msg.id };
  }

  /**
   * ROK-2292 review MAJOR — an event post exists from announce, days before
   * the event, so it gets the longest auto-archive (a webhook execute cannot
   * set it, so it is set after). Best effort: the post already exists, and a
   * throw here would re-create it on retry.
   */
  private async keepOpenAWeek(threadId: string): Promise<void> {
    try {
      const thread = await this.thread(threadId);
      await thread.setAutoArchiveDuration(
        ThreadAutoArchiveDuration.OneWeek,
        REASON,
      );
    } catch (err) {
      this.logger.warn(
        `Could not set post ${threadId} auto-archive: ${String(err)}`,
      );
    }
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
   * ROK-2292 D4/D5 — edit a post's starter message (its id IS the thread
   * id) to the event card, content `''`, as `author`: Discord rejects the bot
   * editing a webhook's message (50005). A missing forum/webhook (Codex P2)
   * or a 404 is `'gone'`; anything else throws (50083 is the port's call).
   */
  async editStarterCard(
    threadId: string,
    card: ForumStarterCard,
    author: StarterAuthor,
  ): Promise<DiscordWriteResult> {
    const body = { content: '', ...card, allowedMentions: NO_MENTIONS };
    try {
      if (author.kind === 'bot') {
        const thread = await this.thread(threadId);
        await thread.messages.edit(threadId, body);
        return 'ok';
      }
      const fetch = (t: OutboundTarget) => this.webhook(t);
      const hook = await this.starterHooks.get(author.target, fetch);
      await hook.editMessage(threadId, { ...body, threadId });
      return 'ok';
    } catch (err) {
      if (author.kind === 'webhook' && !isArchivedError(err)) {
        this.starterHooks.evict(author.target);
      }
      if (isGone(err) || err instanceof ForumWebhookGoneError) return 'gone';
      throw err;
    }
  }

  /**
   * ROK-2292 review MAJOR: reopen an auto-archived post (Manage Threads).
   * Returns false — and leaves the post alone — when Discord already shows it
   * locked: the lock sweep locks on Discord before it stamps our records, so
   * reopening it there would undo a close (delta-review MINOR).
   */
  async unarchiveThread(discordThreadId: string): Promise<boolean> {
    const thread = await this.thread(discordThreadId, true);
    if (thread.locked) return false;
    if (thread.archived) await thread.setArchived(false, REASON);
    return true;
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

  /**
   * The forum's webhook, token included (OQ-9: re-fetched, never stored in
   * the DB; the starter path keeps it briefly in memory — `starterHooks`).
   */
  private async webhook(target: OutboundTarget): Promise<Webhook> {
    const ch = await this.guild().channels.fetch(target.channelId);
    if (ch?.type !== ChannelType.GuildForum) {
      throw new ForumWebhookGoneError(`Forum ${target.channelId} is gone`);
    }
    const hook = (await ch.fetchWebhooks()).get(target.webhookId);
    if (!hook?.token) {
      throw new ForumWebhookGoneError(`Webhook ${target.webhookId} is gone`);
    }
    return hook;
  }
}
