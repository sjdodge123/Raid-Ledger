/**
 * ROK-2208 §5.4 steps 1–4 — where an inbound Discord message goes. Pure rules
 * (echo guards D5, hub routing by tag D7/OQ-4, the R8 cut-off) plus a cached
 * channel → bindings resolver (60 s TTL). Plain shapes only: the gateway
 * edge maps discord.js objects into {@link InboundMessage}/{@link InboundThread}.
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** A Discord message, reduced to what the inbound sync reads. */
export interface InboundMessage {
  id: string;
  /** The forum post (thread) the message lives in. */
  threadId: string;
  authorId: string;
  /** Member display name ?? global name ?? username. */
  authorName: string;
  authorAvatar: string | null;
  webhookId: string | null;
  content: string;
  /** `<@id>` → display name, for mention rewriting. */
  mentions: ReadonlyMap<string, string>;
  attachments: readonly { name: string; url: string }[];
}

/** A Discord forum post (thread channel). */
export interface InboundThread {
  id: string;
  parentId: string | null;
  name: string;
  appliedTags: readonly string[];
  pinned: boolean;
  archived: boolean;
}

/** One hub bound to a forum. */
export interface RouteBinding {
  guildId: number;
  tagId: string | null;
  boundAt: Date;
}

/** A bound forum channel and the hubs bound to it. */
export interface ForumRoute {
  channelId: string;
  webhookId: string | null;
  bindings: RouteBinding[];
}

/** Discord's epoch (2015-01-01) in ms. */
const DISCORD_EPOCH = 1420070400000n;

/** The creation time encoded in a snowflake. */
export function snowflakeTime(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

/**
 * D5 echo guards 1–2: our bot user, or this forum's own webhook. Guard 3
 * (an existing link) needs the database and lives in the ingest.
 */
export function isEcho(
  message: Pick<InboundMessage, 'authorId' | 'webhookId'>,
  ctx: { botUserId: string | null; webhookId: string | null },
): boolean {
  if (ctx.botUserId !== null && message.authorId === ctx.botUserId) return true;
  return message.webhookId !== null && message.webhookId === ctx.webhookId;
}

/**
 * §5.4 step 3 for a NOT yet linked post: one binding → that hub; a shared
 * forum → exactly one hub tag among the post's tags, else null (OQ-4).
 */
export function pickHub(
  bindings: readonly RouteBinding[],
  appliedTags: readonly string[],
): RouteBinding | null {
  if (bindings.length === 1) return bindings[0] ?? null;
  const tags = new Set(appliedTags);
  const hits = bindings.filter((b) => b.tagId !== null && tags.has(b.tagId));
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/** R8: a post created before the hub's binding never imports. */
export function predatesBinding(threadId: string, boundAt: Date): boolean {
  return snowflakeTime(threadId).getTime() < boundAt.getTime();
}

/** Bound forum channels by Discord channel id, cached for 60 s. */
@Injectable()
export class HubForumDiscordRouteResolver {
  static readonly TTL_MS = 60_000;
  private readonly cache = new Map<
    string,
    { at: number; route: ForumRoute | null }
  >();

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb) {}

  /** The forum's route, or null when no hub binds the channel. */
  async resolve(channelId: string, now = Date.now()): Promise<ForumRoute | null> {
    const hit = this.cache.get(channelId);
    if (hit && now - hit.at < HubForumDiscordRouteResolver.TTL_MS) {
      return hit.route;
    }
    const route = await loadRoute(this.db, channelId);
    this.cache.set(channelId, { at: now, route });
    return route;
  }

  /** Forget everything (bind/unbind, tests). */
  invalidate(): void {
    this.cache.clear();
  }
}

async function loadRoute(
  db: ForumDiscordDb,
  channelId: string,
): Promise<ForumRoute | null> {
  const f = schema.hubForumDiscordForums;
  const b = schema.hubForumDiscordBindings;
  const rows = await db
    .select({
      webhookId: f.webhookId,
      guildId: b.guildId,
      tagId: b.tagId,
      boundAt: b.boundAt,
    })
    .from(f)
    .innerJoin(b, eq(b.forumId, f.id))
    .where(eq(f.channelId, channelId));
  const first = rows[0];
  if (!first) return null;
  const bindings = rows.map(({ guildId, tagId, boundAt }) => ({
    guildId,
    tagId,
    boundAt,
  }));
  return { channelId, webhookId: first.webhookId, bindings };
}
