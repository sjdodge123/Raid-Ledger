/**
 * ROK-2272 S4a — the lifecycle listener for Discord-only event-planning
 * posts (a Core-plugin behaviour). Every lifecycle emit re-derives an
 * EXISTING post's title and `closes_at`; there is no CREATED handler because
 * posts are created lazily by the first signup ping. DELETED closes
 * unconditionally because the single-event delete emits BEFORE the row is
 * gone and the series delete AFTER. Failures are logged and captured, never
 * thrown into the emitter. ROK-2314: UPDATED (reschedule lock-in re-emits
 * it), RESCHEDULING and RESCHEDULE_CLEARED then flip that event's post lock
 * (hub and registry) right away, so the post closes while a reschedule poll
 * runs and reopens when it ends — after the re-sync, so the reopen retitles
 * with the moved `closes_at`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import * as Sentry from '@sentry/nestjs';
import {
  APP_EVENT_EVENTS,
  DISCORD_BOT_EVENTS,
} from '../../../discord-bot/discord-bot.constants';
import { lifecycleEventId } from '../event-discussion/event-discussion.listener';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';

@Injectable()
export class EventPlanningPostsListener {
  private readonly logger = new Logger(EventPlanningPostsListener.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'event-planning.discord-posts';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(
    private readonly service: EventPlanningPostsService,
    private readonly lock: HubForumDiscordEventLockSweep,
  ) {}

  @OnEvent(APP_EVENT_EVENTS.UPDATED, { async: true })
  onUpdated(payload: unknown): Promise<void> {
    return this.syncThenFlip('updated', payload);
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED, { async: true })
  onCancelled(payload: unknown): Promise<void> {
    return this.run('cancelled', payload, (id) => this.service.syncEvent(id));
  }

  @OnEvent(APP_EVENT_EVENTS.RESCHEDULING, { async: true })
  onRescheduling(payload: unknown): Promise<void> {
    return this.syncThenFlip('rescheduling', payload);
  }

  @OnEvent(APP_EVENT_EVENTS.RESCHEDULE_CLEARED, { async: true })
  onRescheduleCleared(payload: unknown): Promise<void> {
    return this.syncThenFlip('reschedule-cleared', payload);
  }

  /** Re-sync the post, then (even if that failed) flip its lock now. */
  private async syncThenFlip(what: string, payload: unknown): Promise<void> {
    await this.run(what, payload, (id) => this.service.syncEvent(id));
    await this.run(`${what}-lock`, payload, (id) => this.lock.sweepEvent(id));
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED, { async: true })
  onDeleted(payload: unknown): Promise<void> {
    return this.run('deleted', payload, (id) =>
      this.service.closeForDeletedEvent(id),
    );
  }

  /**
   * Codex P2-2: on every (re)connect — the same trigger as the hub
   * reconcile — replay retitles skipped while the bot was offline.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED, { async: true })
  async onConnected(): Promise<void> {
    try {
      await this.service.resyncLiveEventPosts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`event-planning post reconnect resync failed: ${msg}`);
      Sentry.captureException(err, {
        tags: { event_planning_posts: 'reconnect' },
      });
    }
  }

  private async run(
    what: string,
    payload: unknown,
    fn: (eventId: number) => Promise<unknown>,
  ): Promise<void> {
    const eventId = lifecycleEventId(payload);
    if (eventId === null) return;
    try {
      await fn(eventId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `event-planning post sync (${what}) failed for event ${eventId}: ${msg}`,
      );
      Sentry.captureException(err, {
        tags: { event_planning_posts: what },
      });
    }
  }
}
