/**
 * ROK-2314 review MAJOR-2 / MINOR-1 — what a hub post owes Discord once it
 * reopens (a reschedule poll ended, or its deadline moved out again). While
 * the post was archived, website replies failed to send (an archived thread
 * rejects writes) and may have run out their retries; signup lines were held
 * back by the flush. On reopen the held replies are reset and re-driven in
 * the order they were written, then the event's signup flush is re-armed.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { ForumLink } from './hub-forum-discord-links.queries';
import { HubForumDiscordReconcileService } from './hub-forum-discord-reconcile';
import { HubForumDiscordSignupPingQueue } from './hub-forum-discord-signup-pings.queue';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const links = schema.hubForumDiscordLinks;

/** The reopened hub post. */
export interface ReopenedHubPost {
  threadId: number;
  /** The thread's event (null for a poll / lineup thread). */
  eventId: number | null;
  discordThreadId: string;
}

/**
 * Make every website reply of this thread that failed to reach Discord due
 * again: attempts back to 0, error cleared. Abandoned rows are `failed` at
 * the attempts cap, so they come back too; landed rows are `synced` and never
 * match, so nothing is sent twice. Returns the reset rows in id order.
 */
export async function requeueHeldReplies(
  db: ForumDiscordDb,
  threadId: number,
): Promise<ForumLink[]> {
  const rows = await db
    .update(links)
    .set({ attempts: 0, lastError: null })
    .where(
      and(
        eq(links.threadId, threadId),
        eq(links.kind, 'reply'),
        eq(links.origin, 'raidledger'),
        eq(links.syncState, 'failed'),
        isNull(links.discordDeletedAt),
      ),
    )
    .returning();
  return rows.sort((a, b) => a.id - b.id);
}

/** Re-drives a reopened hub post's held replies and signup lines. */
@Injectable()
export class HubEventPostReopenFollowups {
  private readonly logger = new Logger(HubEventPostReopenFollowups.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly reconcile: HubForumDiscordReconcileService,
    private readonly pings: HubForumDiscordSignupPingQueue,
  ) {}

  /**
   * Replies first (oldest first), then the event's signup flush. Never
   * throws: a failure is logged and the 5-minute retry sweep catches up.
   */
  async afterReopen(post: ReopenedHubPost): Promise<void> {
    await this.redriveReplies(post);
    if (post.eventId === null) return;
    try {
      await this.pings.schedule(post.eventId);
    } catch (err) {
      this.warn(post, 'signup flush', err);
    }
  }

  private async redriveReplies(post: ReopenedHubPost): Promise<void> {
    try {
      const held = await requeueHeldReplies(this.db, post.threadId);
      if (held.length > 0) await this.reconcile.retryLinks(held);
    } catch (err) {
      this.warn(post, 'held replies', err);
    }
  }

  private warn(post: ReopenedHubPost, what: string, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Reopened post ${post.discordThreadId} ${what}: ${why}`);
  }
}
