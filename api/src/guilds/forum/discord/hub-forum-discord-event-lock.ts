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
  type SQL,
} from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  deleteForumStarterRows,
  EventForumStarterCards,
} from '../../../discord-bot/services/event-forum-starter.cards';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { syncExpiredPolls } from '../subject-discussion/poll-discussion.deadline';
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
  /** The thread's event (null for a poll / lineup thread). */
  eventId: number | null;
}

/** A thread with a subject (event, poll or lineup — ROK-2272 S8). */
const HAS_SUBJECT = or(
  isNotNull(threads.eventId),
  isNotNull(threads.matchId),
  isNotNull(threads.lineupId),
);

/** The RL thread is read-only at `now` (closed or detached). */
function readOnlyAt(now: Date) {
  const at = sql`${now.toISOString()}::timestamptz`;
  return sql<boolean>`(${threads.eventDetachedAt} IS NOT NULL OR COALESCE(${threads.writeClosesAt} <= ${at}, false))`;
}

/** The recorded Discord lock state differs from the RL read-only state. */
function disagrees(readOnly: SQL<boolean>) {
  return or(
    and(readOnly, isNull(links.discordLockedAt)),
    and(not(readOnly), isNotNull(links.discordLockedAt)),
  );
}

/**
 * Linked, sent, undeleted subject-thread posts (event, poll or lineup —
 * ROK-2272 S8) whose lock state must flip —
 * only in the hub's CURRENT binding (D9: an unbound or re-bound hub's old
 * posts are left alone, review MINOR-5).
 */
export async function dueLockChanges(
  db: ForumDiscordDb,
  now: Date,
): Promise<LockChange[]> {
  const readOnly = readOnlyAt(now);
  return db
    .select({
      linkId: links.id,
      guildId: links.guildId,
      threadId: links.threadId,
      discordThreadId: links.discordThreadId,
      readOnly,
      eventId: threads.eventId,
    })
    .from(links)
    .innerJoin(threads, eq(threads.id, links.threadId))
    .innerJoin(bindings, eq(bindings.guildId, links.guildId))
    .where(
      and(
        eq(links.kind, 'thread'),
        gte(links.createdAt, bindings.boundAt),
        HAS_SUBJECT,
        isNull(links.discordDeletedAt),
        not(like(links.discordThreadId, `${UNSENT_PREFIX}%`)),
        disagrees(readOnly),
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
    private readonly starters: EventForumStarterCards,
  ) {}

  /**
   * ROK-2272 S8: first the poll-deadline pass (RL-side state — stamps the
   * close time on polls whose deadline passed unobserved; runs even while
   * the bot is offline), then flip every due post — hub links, then the
   * event-planning registry (ROK-2272 S4a). A throw in one pass never stops
   * the others, but the first one is rethrown after all ran so the cron
   * records a failure (review MAJOR-1). Returns how many POSTS changed (the
   * deadline pass is not counted). Offline bot → no Discord pass, 0.
   */
  async sweep(now = new Date()): Promise<number> {
    const errors: unknown[] = [];
    await this.pass('poll-deadline', errors, () =>
      syncExpiredPolls(this.db, now),
    );
    const posts = this.client.isConnected()
      ? await this.sweepPosts(now, errors)
      : 0;
    if (errors.length > 0) throw errors[0];
    return posts;
  }

  /** The two Discord passes, each isolated by `pass`. */
  private async sweepPosts(now: Date, errors: unknown[]): Promise<number> {
    const hub = await this.pass('hub', errors, () => this.sweepHub(now));
    const reg = await this.pass('registry', errors, () =>
      this.registry.sweep(now),
    );
    return hub + reg;
  }

  private async sweepHub(now: Date): Promise<number> {
    let changed = 0;
    for (const row of await this.due(now)) {
      if (await this.apply(row, now)) changed += 1;
    }
    return changed;
  }

  /** One pass; a throw is logged, collected into `errors`, counted as 0. */
  private async pass(
    what: string,
    errors: unknown[],
    fn: () => Promise<number>,
  ): Promise<number> {
    try {
      return await fn();
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Event lock sweep (${what}) failed: ${why}`);
      errors.push(err);
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
      // ROK-2292 D7: a locked (closed / detached) post's starter stops syncing.
      if (row.readOnly)
        await deleteForumStarterRows(this.db, row.discordThreadId);
    } catch (err) {
      this.warn(row, err);
      return false;
    }
    if (!row.readOnly) await this.refresh(row);
    return true;
  }

  /**
   * Reopened: track the event starter again (ROK-2292, D7 dropped it), then
   * push the title/starter skipped while locked (binding-checked).
   */
  private async refresh(row: LockChange): Promise<void> {
    const { guildId, threadId, eventId } = row;
    try {
      if (eventId !== null)
        await this.starters.restore(eventId, row.discordThreadId);
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
