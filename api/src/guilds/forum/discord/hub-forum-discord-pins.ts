/**
 * ROK-2208 §5.5 (R5, OQ-2) — pin sync both ways. Only the hub's NEWEST live
 * pinned linked thread maps to the forum's single Discord pin; RL may hold
 * more pins. A shared forum's pin goes to the latest pin action across its
 * hubs; a hub that loses it keeps its RL pin. Inbound pins never emit (D2).
 */
import { Inject, Injectable } from '@nestjs/common';
import { ChannelFlags, ChannelType, type Guild } from 'discord.js';
import { and, desc, eq, gte, isNotNull, isNull, not, like } from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  UNSENT_PREFIX,
  type ForumLink,
} from './hub-forum-discord-links.queries';
import { isGone } from './hub-forum-discord-outbound.discord';
import { findBinding, type ForumDiscordDb } from './hub-forum-discord.queries';

const threads = schema.hubForumThreads;
const links = schema.hubForumDiscordLinks;
const bindings = schema.hubForumDiscordBindings;
const REASON = 'Raid Ledger hub forum pin sync';
/** How long a sync pin flip waits for its gateway echo. */
const ECHO_TTL_MS = 60_000;

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
  /** Our own pending pin flips, awaiting their gateway echo. */
  private readonly echoes = new PinEchoes();

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
        await this.flip(current, false);
      }
      return;
    }
    if (current !== null) await this.flip(current, false);
    await this.flip(want, true);
  }

  /** Discord → RL for a linked post whose PINNED flag changed. */
  async pullPost(link: ForumLink, change: PinChange, now: Date): Promise<void> {
    if (change.wasPinned === change.isPinned) return;
    if (this.isOwnEcho(link.discordThreadId, change.isPinned)) return;
    const target = and(
      eq(threads.id, link.threadId),
      isNull(threads.deletedAt),
    );
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

  /**
   * Pin/unpin on Discord and remember it: the ThreadUpdate it echoes back is
   * ours, not a user's (codex P2 — a hub losing the shared pin keeps its RL
   * pin). Forgotten on failure; expires after ECHO_TTL_MS.
   */
  private async flip(postId: string, pinned: boolean): Promise<void> {
    this.echoes.record(postId, pinned);
    try {
      await this.gateway.setPinned(postId, pinned);
    } catch (err) {
      this.echoes.forget(postId, pinned);
      throw err;
    }
  }

  /** Consume a pending echo of our own pin change for this post. */
  private isOwnEcho(postId: string, pinned: boolean): boolean {
    return this.echoes.consume(postId, pinned);
  }
}

const echoKey = (postId: string, pinned: boolean) =>
  `${postId}:${pinned ? 'pin' : 'unpin'}`;

/**
 * Pending echoes (`postId:pin|unpin` → expiry ms). Review M2: a flip whose
 * echo never arrives (no-op pin, unlinked post, dropped gateway event) is
 * pruned once expired, so the map stays bounded by flips in the last TTL.
 */
export class PinEchoes {
  private readonly until = new Map<string, number>();

  constructor(private readonly ttlMs = ECHO_TTL_MS) {}

  get size(): number {
    return this.until.size;
  }

  record(postId: string, pinned: boolean, now = Date.now()): void {
    for (const [key, at] of this.until) if (at < now) this.until.delete(key);
    this.until.set(echoKey(postId, pinned), now + this.ttlMs);
  }

  forget(postId: string, pinned: boolean): void {
    this.until.delete(echoKey(postId, pinned));
  }

  /** True (and forgotten) when this flip is our own, still in its window. */
  consume(postId: string, pinned: boolean, now = Date.now()): boolean {
    const key = echoKey(postId, pinned);
    const at = this.until.get(key);
    if (at === undefined) return false;
    this.until.delete(key);
    return at >= now;
  }
}

/** The Discord post id of the hub's newest live pinned linked thread in its current forum. */
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
    // Codex P2: only posts synced under the CURRENT binding (D9) — a hub
    // that re-bound keeps its old forum's links, which must never be picked.
    .innerJoin(bindings, eq(bindings.guildId, threads.guildId))
    .where(
      and(
        eq(threads.guildId, guildId),
        gte(links.createdAt, bindings.boundAt),
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
