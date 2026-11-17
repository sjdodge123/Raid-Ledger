/**
 * ROK-2208 §5.7 item 4 (R12) — Discord side of an event thread's read-only
 * state. A linked event thread whose RL thread is read-only
 * (`write_closes_at <= now` or `event_detached_at` set) gets its Discord post
 * locked THEN archived; a reschedule that reopens it (deadline in the future
 * again, not detached) unarchives THEN unlocks. `discord_locked_at` on the
 * link row records the state, so the 5-minute Core sweep
 * (`HubForumDiscordSync_eventLockSweep`) is idempotent. Archiving unpins on
 * Discord — fine, R5 keeps the RL pin.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, isNull, like, not, or, sql } from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { UNSENT_PREFIX } from './hub-forum-discord-links.queries';
import { isGone } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const links = schema.hubForumDiscordLinks;
const threads = schema.hubForumThreads;
const REASON = 'Raid Ledger event discussion is read-only';
/** Posts per tick; the rest wait 5 minutes. */
const BATCH = 50;

/** One post whose Discord lock state disagrees with its RL thread. */
export interface LockChange {
  linkId: number;
  discordThreadId: string;
  readOnly: boolean;
}

/** Lock/archive a forum post behind a plain id (spied on by specs). */
@Injectable()
export class HubForumDiscordEventLockGateway {
  constructor(private readonly client: DiscordBotClientService) {}

  /** Read-only: lock then archive; reopened: unarchive then unlock. */
  async setReadOnly(postId: string, readOnly: boolean): Promise<void> {
    const guild = this.client.isConnected() ? this.client.getGuild() : null;
    if (!guild) throw new Error('Discord bot is offline');
    try {
      const ch = await guild.channels.fetch(postId);
      if (!ch?.isThread()) return;
      if (readOnly) {
        await ch.setLocked(true, REASON);
        await ch.setArchived(true, REASON);
      } else {
        await ch.setArchived(false, REASON);
        await ch.setLocked(false, REASON);
      }
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }
}

/** Linked, sent, undeleted event-thread posts whose lock state must flip. */
export async function dueLockChanges(
  db: ForumDiscordDb,
  now: Date,
): Promise<LockChange[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const readOnly = sql<boolean>`(${threads.eventDetachedAt} IS NOT NULL OR COALESCE(${threads.writeClosesAt} <= ${at}, false))`;
  return db
    .select({
      linkId: links.id,
      discordThreadId: links.discordThreadId,
      readOnly,
    })
    .from(links)
    .innerJoin(threads, eq(threads.id, links.threadId))
    .where(
      and(
        eq(links.kind, 'thread'),
        isNotNull(threads.eventId),
        isNull(links.discordDeletedAt),
        not(like(links.discordThreadId, `${UNSENT_PREFIX}%`)),
        or(
          and(readOnly, isNull(links.discordLockedAt)),
          and(not(readOnly), isNotNull(links.discordLockedAt)),
        ),
      ),
    )
    .orderBy(links.id)
    .limit(BATCH);
}

/** The sweep the Core cron runs. */
@Injectable()
export class HubForumDiscordEventLockSweep {
  private readonly logger = new Logger(HubForumDiscordEventLockSweep.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordEventLockGateway,
    private readonly client: DiscordBotClientService,
  ) {}

  /** Flip every due post; returns how many changed. Offline bot → 0. */
  async sweep(now = new Date()): Promise<number> {
    if (!this.client.isConnected()) return 0;
    let changed = 0;
    for (const row of await this.due(now)) {
      if (await this.apply(row, now)) changed += 1;
    }
    return changed;
  }

  /** The posts to flip this tick. */
  due(now: Date): Promise<LockChange[]> {
    return dueLockChanges(this.db, now);
  }

  /** Discord first, then record it; a failure retries next tick. */
  private async apply(row: LockChange, now: Date): Promise<boolean> {
    try {
      await this.gateway.setReadOnly(row.discordThreadId, row.readOnly);
      await this.db
        .update(links)
        .set({ discordLockedAt: row.readOnly ? now : null })
        .where(eq(links.id, row.linkId));
      return true;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Event post ${row.discordThreadId} lock: ${why}`);
      return false;
    }
  }
}
