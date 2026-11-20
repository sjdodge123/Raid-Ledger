/**
 * ROK-2272 S4a — the lifecycle listener for Discord-only event-planning
 * posts (a Core-plugin behaviour). Every lifecycle emit re-derives an
 * EXISTING post's title and `closes_at`; there is no CREATED handler because
 * posts are created lazily by the first signup ping. DELETED closes
 * unconditionally because the single-event delete emits BEFORE the row is
 * gone and the series delete AFTER. Failures are logged and captured, never
 * thrown into the emitter.
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

@Injectable()
export class EventPlanningPostsListener {
  private readonly logger = new Logger(EventPlanningPostsListener.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'event-planning.discord-posts';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(private readonly service: EventPlanningPostsService) {}

  @OnEvent(APP_EVENT_EVENTS.UPDATED, { async: true })
  onUpdated(payload: unknown): Promise<void> {
    return this.run('updated', payload, (id) => this.service.syncEvent(id));
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED, { async: true })
  onCancelled(payload: unknown): Promise<void> {
    return this.run('cancelled', payload, (id) => this.service.syncEvent(id));
  }

  @OnEvent(APP_EVENT_EVENTS.RESCHEDULING, { async: true })
  onRescheduling(payload: unknown): Promise<void> {
    return this.run('rescheduling', payload, (id) =>
      this.service.syncEvent(id),
    );
  }

  @OnEvent(APP_EVENT_EVENTS.RESCHEDULE_CLEARED, { async: true })
  onRescheduleCleared(payload: unknown): Promise<void> {
    return this.run('reschedule-cleared', payload, (id) =>
      this.service.syncEvent(id),
    );
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
