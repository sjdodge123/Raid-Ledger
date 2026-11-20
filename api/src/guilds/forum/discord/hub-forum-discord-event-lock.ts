/**
 * ROK-2208 §5.7 item 4 (R12) — Discord side of an event thread's read-only
 * state. A linked event thread whose RL thread is read-only
 * (`write_closes_at <= now` or `event_detached_at` set) gets its Discord post
 * locked THEN archived; a reschedule that reopens it (deadline in the future
 * again, not detached) unarchives THEN unlocks. `discord_locked_at` on the
 * link row records the state, so the 5-minute Core sweep
 * (`HubForumDiscordSync_eventLockSweep`) is idempotent. Archiving unpins on
 * Discord — fine, R5 keeps the RL pin. While locked, `editThread` skips the
 * post (an archived thread rejects edits, 50083), so a reopen re-drives it as
 * `thread.updated` to pick up the current dated title (review MINOR-1).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  eq,
  gte,
  isNotNull,
  isNull,
  like,
  not,
  or,
  sql,
} from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { EventPlanningPostsLockSweep } from './event-planning-posts.lock';
import { HubForumDiscordEventLockGateway } from './hub-forum-discord-event-lock.gateway';
import { UNSENT_PREFIX } from './hub-forum-discord-links.queries';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

// Re-exported: specs and the module import it from here.
export { HubForumDiscordEventLockGateway };

const links = schema.hubForumDiscordLinks;
const threads = schema.hubForumThreads;
const bindings = schema.hubForumDiscordBindings;
/** Posts per tick; the rest wait 5 minutes. */
const BATCH = 50;

/** One post whose Discord lock state disagrees with its RL thread. */
export interface LockChange {
  linkId: number;
  guildId: number;
  threadId: number;
  discordThreadId: string;
  readOnly: boolean;
}

/**
 * Linked, sent, undeleted event-thread posts whose lock state must flip —
 * only in the hub's CURRENT binding (D9: an unbound or re-bound hub's old
 * posts are left alone, review MINOR-5).
 */
export async function dueLockChanges(
  db: ForumDiscordDb,
  now: Date,
): Promise<LockChange[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const readOnly = sql<boolean>`(${threads.eventDetachedAt} IS NOT NULL OR COALESCE(${threads.writeClosesAt} <= ${at}, false))`;
  return db
    .select({
      linkId: links.id,
      guildId: links.guildId,
      threadId: links.threadId,
      discordThreadId: links.discordThreadId,
      readOnly,
    })
    .from(links)
    .innerJoin(threads, eq(threads.id, links.threadId))
    .innerJoin(bindings, eq(bindings.guildId, links.guildId))
    .where(
      and(
        eq(links.kind, 'thread'),
        gte(links.createdAt, bindings.boundAt),
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
    private readonly outbound: HubForumDiscordOutboundService,
    private readonly registry: EventPlanningPostsLockSweep,
  ) {}

  /**
   * Flip every due post — hub links, then the event-planning registry
   * (ROK-2272 S4a); a throw in one pass never stops the other. Returns how
   * many changed. Offline bot → 0.
   */
  async sweep(now = new Date()): Promise<number> {
    if (!this.client.isConnected()) return 0;
    const hub = await this.pass('hub', () => this.sweepHub(now));
    const reg = await this.pass('registry', () => this.registry.sweep(now));
    return hub + reg;
  }

  private async sweepHub(now: Date): Promise<number> {
    let changed = 0;
    for (const row of await this.due(now)) {
      if (await this.apply(row, now)) changed += 1;
    }
    return changed;
  }

  private async pass(what: string, fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Event lock sweep (${what}) failed: ${why}`);
      return 0;
    }
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
    } catch (err) {
      this.warn(row, err);
      return false;
    }
    if (!row.readOnly) await this.refresh(row);
    return true;
  }

  /** Reopened: push the title/starter skipped while locked (binding-checked). */
  private async refresh(row: LockChange): Promise<void> {
    const { guildId, threadId } = row;
    try {
      await this.outbound.apply({
        guildId,
        threadId,
        op: 'thread.updated',
        actorId: 0,
      });
    } catch (err) {
      this.warn(row, err);
    }
  }

  private warn(row: LockChange, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Event post ${row.discordThreadId} lock: ${why}`);
  }
}
