/**
 * ROK-2208 §5.4 — inbound Discord → RL on plain data (no discord.js): route
 * to the bound hub, drop echoes (D5), import threads/replies as the linked
 * RL user or a Discord guest (R2/R7), apply Discord-origin edits at any time
 * and Discord deletes (R3/§5.3), and hand pin flips to the pin sync (R5).
 * No backfill (R8). Nothing here emits `hub-forum.changed` (D2).
 */
import { Inject, Injectable } from '@nestjs/common';
import { HUB_FORUM_TITLE_MAX } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { ForumLink } from './hub-forum-discord-links.queries';
import * as inbound from './hub-forum-discord-inbound.writes';
import {
  HubForumDiscordNotices,
  needsTagNotice,
} from './hub-forum-discord-notice';
import { HubForumDiscordPinSync } from './hub-forum-discord-pins';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import {
  HubForumDiscordRouteResolver,
  isEcho,
  pickHub,
  predatesBinding,
  type ForumRoute,
  type InboundMessage,
  type InboundThread,
} from './hub-forum-discord-route';

/** Body CHECK is 1..4000; an attachment-only message still needs text. */
export const EMPTY_BODY = '(attachment — view in Discord)';
const BODY_MAX = 4000;

/** What an inbound event did (the spec reads this; the listener ignores it). */
export type InboundResult = 'imported' | 'updated' | 'deleted' | 'skipped';

/** Per-event context the gateway edge supplies. */
export interface InboundCtx {
  botUserId: string | null;
  /** The post's starter, for a reply in a post whose starter was missed. */
  fetchStarter?: () => Promise<InboundMessage | null>;
}

function cut(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}

/** §5.4 step 7: mentions → `@name`, attachments as links, never empty. */
export function inboundBody(
  m: Pick<InboundMessage, 'content' | 'mentions' | 'attachments'>,
): string {
  const text = m.content.replace(/<@!?(\d+)>/g, (raw, id: string) => {
    const name = m.mentions.get(id);
    return name === undefined ? raw : `@${name}`;
  });
  const files = m.attachments.map((a) => `[attachment: ${a.name}](${a.url})`);
  const body = [text.trim(), ...files].filter((s) => s.length > 0).join('\n');
  return body.length === 0 ? EMPTY_BODY : cut(body, BODY_MAX);
}

/** A post name as an RL title (1..120). */
export function inboundTitle(name: string): string {
  return cut(name.trim(), HUB_FORUM_TITLE_MAX) || 'Discord post';
}

/** Inbound Discord → RL sync. */
@Injectable()
export class HubForumDiscordInboundIngest {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly routes: HubForumDiscordRouteResolver,
    private readonly pins: HubForumDiscordPinSync,
    private readonly notices: HubForumDiscordNotices,
  ) {}

  /** A new message in a forum post (starter or reply). */
  async onCreate(
    m: InboundMessage,
    thread: InboundThread,
    ctx: InboundCtx,
    now = new Date(),
  ): Promise<InboundResult> {
    const route = await this.routeOf(thread.parentId);
    if (!route || (await this.isEcho(m, route, ctx))) return 'skipped';
    const post = await inbound.findPostLink(this.db, thread.id);
    if (post) {
      // Review MAJOR-2: only while the post's hub still binds this forum.
      const bound = route.bindings.some((b) => b.guildId === post.guildId);
      return bound ? this.importReply(post, m, now) : 'skipped';
    }
    const hub = pickHub(route.bindings, thread.appliedTags);
    if (!hub) return this.tagNotice(route, thread);
    if (predatesBinding(thread.id, hub.boundAt)) return 'skipped';
    if (m.id === thread.id)
      return this.importThread(hub.guildId, thread, m, now);
    const starter = ctx.fetchStarter ? await ctx.fetchStarter() : null;
    if (!starter || (await this.isEcho(starter, route, ctx))) return 'skipped';
    await this.importThread(hub.guildId, thread, starter, now);
    const fresh = await inbound.findPostLink(this.db, thread.id);
    return fresh ? this.importReply(fresh, m, now) : 'skipped';
  }

  /** R3: a Discord-origin message was edited (any age). */
  async onUpdate(
    m: InboundMessage,
    parentId: string | null,
    now = new Date(),
  ): Promise<InboundResult> {
    const link = await inbound.findLinkByMessage(this.db, m.id);
    if (!link || link.origin !== 'discord') return 'skipped';
    if (!(await this.boundTo(parentId, link.guildId))) return 'skipped';
    await inbound.editFromDiscord(this.db, link, { body: inboundBody(m), now });
    return 'updated';
  }

  /** §5.3: a message was deleted on Discord. */
  async onDelete(
    messageId: string,
    parentId: string | null,
    now = new Date(),
  ): Promise<InboundResult> {
    const link = await inbound.findLinkByMessage(this.db, messageId);
    if (!link || link.discordDeletedAt !== null) return 'skipped';
    if (!(await this.boundTo(parentId, link.guildId))) return 'skipped';
    const as = link.origin === 'discord' ? 'author' : 'moderator';
    await inbound.removeFromDiscord(this.db, link, as, now);
    return 'deleted';
  }

  /** Post renamed (Discord-origin → title) and/or pin flag flipped (R5). */
  async onThreadUpdate(
    before: InboundThread,
    after: InboundThread,
    now = new Date(),
  ): Promise<InboundResult> {
    const link = await inbound.findPostLink(this.db, after.id);
    if (!link || !(await this.boundTo(after.parentId, link.guildId))) {
      return 'skipped';
    }
    if (link.origin === 'discord' && before.name !== after.name) {
      const title = inboundTitle(after.name);
      await inbound.editFromDiscord(this.db, link, { title, now });
    }
    const change = {
      wasPinned: before.pinned,
      isPinned: after.pinned,
      archived: after.archived,
    };
    await this.pins.pullPost(link, change, now);
    return 'updated';
  }

  /** The whole post was deleted on Discord → RL moderator removal. */
  async onThreadDelete(
    thread: InboundThread,
    now = new Date(),
  ): Promise<InboundResult> {
    const link = await inbound.findPostLink(this.db, thread.id);
    if (!link || link.discordDeletedAt !== null) return 'skipped';
    if (!(await this.boundTo(thread.parentId, link.guildId))) return 'skipped';
    await inbound.removeFromDiscord(this.db, link, 'moderator', now);
    return 'deleted';
  }

  private routeOf(parentId: string | null): Promise<ForumRoute | null> {
    return parentId === null
      ? Promise.resolve(null)
      : this.routes.resolve(parentId);
  }

  /** D5: our bot, our webhook, or a message we already linked. */
  private async isEcho(
    m: InboundMessage,
    route: ForumRoute,
    ctx: InboundCtx,
  ): Promise<boolean> {
    const own = { botUserId: ctx.botUserId, webhookId: route.webhookId };
    if (isEcho(m, own)) return true;
    return (await inbound.findLinkByMessage(this.db, m.id)) !== null;
  }

  /** OQ-4: a shared-forum post no single hub tag routes gets one reply. */
  private async tagNotice(
    route: ForumRoute,
    thread: InboundThread,
  ): Promise<InboundResult> {
    if (needsTagNotice(route.bindings, thread)) {
      await this.notices.notify(route.forumId, thread.id);
    }
    return 'skipped';
  }

  /** Unbinding stops the sync (D9): the hub must still bind the forum. */
  private async boundTo(parentId: string | null, guildId: number) {
    const route = await this.routeOf(parentId);
    return route?.bindings.some((b) => b.guildId === guildId) ?? false;
  }

  private async importThread(
    guildId: number,
    thread: InboundThread,
    m: InboundMessage,
    now: Date,
  ): Promise<InboundResult> {
    const row = {
      guildId,
      title: inboundTitle(thread.name),
      body: inboundBody(m),
      now,
    };
    const ids = { discordThreadId: thread.id, discordMessageId: m.id };
    await inbound.insertDiscordThread(
      this.db,
      row,
      await this.authorOf(m),
      ids,
    );
    return 'imported';
  }

  private async importReply(
    post: ForumLink,
    m: InboundMessage,
    now: Date,
  ): Promise<InboundResult> {
    const row = {
      guildId: post.guildId,
      threadId: post.threadId,
      body: inboundBody(m),
      now,
    };
    const ids = {
      discordThreadId: post.discordThreadId,
      discordMessageId: m.id,
    };
    const id = await inbound.insertDiscordReply(
      this.db,
      row,
      await this.authorOf(m),
      ids,
    );
    return id === null ? 'skipped' : 'imported';
  }

  /** R2: the linked RL user, else a guest; R7: bots/webhooks are guests. */
  private async authorOf(m: InboundMessage): Promise<inbound.DiscordAuthor> {
    return {
      authorId: await inbound.userIdForDiscord(this.db, m.authorId),
      authorDiscordId: m.authorId,
      authorDiscordName: cut(m.authorName, 100),
      authorDiscordAvatar: m.authorAvatar,
    };
  }
}
