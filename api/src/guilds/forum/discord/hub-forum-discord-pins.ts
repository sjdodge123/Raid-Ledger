/**
 * ROK-2208 §5.5 (R5, OQ-2) — pin sync both ways. Only the hub's NEWEST live
 * pinned linked thread maps to the forum's single Discord pin; RL may hold
 * more pins. A shared forum's pin goes to the latest pin action across its
 * hubs; a hub that loses it keeps its RL pin. Inbound pins never emit (D2).
 */
import { Inject, Injectable } from '@nestjs/common';
import { ChannelFlags, ChannelType, type Guild } from 'discord.js';
import { and, desc, eq, isNotNull, isNull, not, like } from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { UNSENT_PREFIX, type ForumLink } from './hub-forum-discord-links.queries';
import { isGone } from './hub-forum-discord-outbound.discord';
import { findBinding, type ForumDiscordDb } from './hub-forum-discord.queries';

const threads = schema.hubForumThreads;
const links = schema.hubForumDiscordLinks;
const REASON = 'Raid Ledger hub forum pin sync';

/** The forum's pin, behind plain ids (spied on by the integration spec). */
@Injectable()
export class HubForumDiscordPinGateway {
  constructor(private readonly client: DiscordBotClientService) {}

  /** The Discord post currently PINNED in the forum, or null. */
  async pinnedPost(channelId: string): Promise<string | null> {
    const ch = await this.guild().channels.fetch(channelId);
    if (ch?.type !== ChannelType.GuildForum) return null;
    const { threads: active } = await ch.threads.fetchActive();
    const pinned = active.find((t) => t.flags.has(ChannelFlags.Pinned));
    return pinned?.id ?? null;
  }

  /** Pin or unpin a forum post; a vanished post is not an error. */
  async setPinned(postId: string, pinned: boolean): Promise<void> {
    try {
      const ch = await this.guild().channels.fetch(postId);
      if (!ch?.isThread()) return;
      await (pinned ? ch.pin(REASON) : ch.unpin(REASON));
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }

  private guild(): Guild {
    const guild = this.client.isConnected() ? this.client.getGuild() : null;
    if (!guild) throw new Error('Discord bot is offline');
    return guild;
  }
}

/** A Discord post's pin state before and after a ThreadUpdate. */
export interface PinChange {
  wasPinned: boolean;
  isPinned: boolean;
  /** The update archived the post (archiving clears the flag). */
  archived: boolean;
}

/** RL ↔ Discord pin reconciliation for bound hubs. */
@Injectable()
export class HubForumDiscordPinSync {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordPinGateway,
  ) {}

  /** RL → Discord after an RL pin/unpin in hub `guildId`. */
  async pushHub(guildId: number): Promise<void> {
    const bound = await findBinding(this.db, guildId);
    if (!bound) return;
    const want = await newestPinnedPost(this.db, guildId);
    const current = await this.gateway.pinnedPost(bound.forum.channelId);
    if (current === want) return;
    if (want === null) {
      if (current !== null && (await ownsPost(this.db, guildId, current))) {
        await this.gateway.setPinned(current, false);
      }
      return;
    }
    if (current !== null) await this.gateway.setPinned(current, false);
    await this.gateway.setPinned(want, true);
  }

  /** Discord → RL for a linked post whose PINNED flag changed. */
  async pullPost(link: ForumLink, change: PinChange, now: Date): Promise<void> {
    if (change.wasPinned === change.isPinned) return;
    const target = and(eq(threads.id, link.threadId), isNull(threads.deletedAt));
    if (change.isPinned) {
      await this.db
        .update(threads)
        .set({ pinnedAt: now, pinnedBy: null })
        .where(and(target, isNull(threads.pinnedAt)));
      return;
    }
    if (change.archived) return; // archiving unsets the flag: keep the RL pin
    const newest = await newestPinnedPost(this.db, link.guildId);
    if (newest !== link.discordThreadId) return;
    await this.db
      .update(threads)
      .set({ pinnedAt: null, pinnedBy: null })
      .where(target);
  }
}

/** The Discord post id of the hub's newest live pinned linked thread. */
async function newestPinnedPost(
  db: ForumDiscordDb,
  guildId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ post: links.discordThreadId })
    .from(threads)
    .innerJoin(
      links,
      and(eq(links.threadId, threads.id), eq(links.kind, 'thread')),
    )
    .where(
      and(
        eq(threads.guildId, guildId),
        isNotNull(threads.pinnedAt),
        isNull(threads.deletedAt),
        not(like(links.discordMessageId, `${UNSENT_PREFIX}%`)),
      ),
    )
    .orderBy(desc(threads.pinnedAt), desc(threads.id))
    .limit(1);
  return row?.post ?? null;
}

/** The Discord post is one of this hub's linked threads. */
async function ownsPost(
  db: ForumDiscordDb,
  guildId: number,
  postId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: links.id })
    .from(links)
    .where(
      and(
        eq(links.guildId, guildId),
        eq(links.kind, 'thread'),
        eq(links.discordThreadId, postId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
