/**
 * ROK-2314 review MAJOR-1 — binds `EVENT_POST_REOPEN_PORT` (lineups side:
 * `event-post-reopen.port.ts`). A reschedule poll's lock-in calls it after
 * releasing the event's reschedule lock and BEFORE emitting
 * `POLL_LOCKED_IN`, so the chat copy that event triggers finds the post
 * open. It re-derives the hub thread's `write_closes_at` and the registry
 * post's `closes_at` from the moved event first — a post whose OLD close
 * had passed must not read as past close — then flips the lock (hub, then
 * registry). The UPDATED re-emit that follows repeats this idempotently.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { EventPostReopenPort } from '../../../lineups/standalone-poll/event-post-reopen.port';
import { syncEventDiscussion } from '../event-discussion/event-discussion.sync';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

@Injectable()
export class EventPostReopener implements EventPostReopenPort {
  private readonly logger = new Logger(EventPostReopener.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly service: EventPlanningPostsService,
    private readonly lock: HubForumDiscordEventLockSweep,
  ) {}

  /** Re-sync both close times (each best effort), then flip the lock. */
  async reopenEventPost(eventId: number): Promise<void> {
    await this.resync('hub thread', eventId, () =>
      syncEventDiscussion(this.db, eventId),
    );
    await this.resync('registry post', eventId, () =>
      this.service.syncEvent(eventId),
    );
    await this.lock.sweepEvent(eventId);
  }

  /** One re-sync; a throw is warned, never blocks the flip. */
  private async resync(
    what: string,
    eventId: number,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Event ${eventId} ${what} re-sync failed: ${why}`);
    }
  }
}
