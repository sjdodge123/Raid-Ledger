import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { HubKindRegistry } from '../guilds/hub-kind.registry';
import { gmPostHeadline } from '../guilds/guild-profile.queries';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import { sendClaimedEventNotice } from './event-notice-plan.helpers';
import {
  HUB_NOTIFICATION_EVENTS,
  HUB_POST_COOLDOWN_SECONDS,
  type LeaderPostInput,
} from './hub-notification.constants';
import {
  filterGroupRecipients,
  findGuildName,
  findLateTagEvent,
  type LateTagEvent,
} from './hub-notification.queries';

/**
 * ROK-1832 — per-group notifications: the leader post (D7) and the group
 * copy of a tagged event (D3, D6b). Fire-and-forget callers (D10).
 */
@Injectable()
export class HubNotificationService {
  private readonly logger = new Logger(HubNotificationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly registry: HubKindRegistry,
    private readonly notificationService: NotificationService,
    private readonly dedup: NotificationDedupService,
  ) {}

  @OnEvent(HUB_NOTIFICATION_EVENTS.LEADER_POST)
  onLeaderPost(input: LeaderPostInput): void {
    void this.notifyLeaderPost(input).catch((err: unknown) =>
      this.logger.warn(`Leader-post notice failed: ${String(err)}`),
    );
  }

  @OnEvent(HUB_NOTIFICATION_EVENTS.EVENT_TAGGED)
  onEventTagged(input: { eventId: number }): void {
    void this.notifyLateTag(input.eventId).catch((err: unknown) =>
      this.logger.warn(`Late-tag notice failed: ${String(err)}`),
    );
  }

  /** D3 + D7: notify the group's members that the leader posted. */
  async notifyLeaderPost(input: LeaderPostInput): Promise<void> {
    const headline = gmPostHeadline(input.gmPost);
    if (!headline) return;
    const key = `hub-post:${input.guildId}`;
    if (await this.dedup.checkAndMarkSent(key, HUB_POST_COOLDOWN_SECONDS)) {
      return;
    }
    const guildName =
      (await findGuildName(this.db, input.guildId)) ?? 'your group';
    const ids = await this.resolveGroupRecipients(input.guildId, input.actorId);
    const payload = {
      guildId: input.guildId,
      guildName,
      url: `/guilds/${input.guildId}`,
    };
    await Promise.allSettled(
      ids.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'hub_leader_post',
          title: `New post in ${guildName}`,
          message: headline,
          payload,
        }),
      ),
    );
  }

  /** D3: the group's recipients for an event (creator excluded). */
  async resolveGroupEventRecipients(
    eventId: number,
    guildId: number,
    creatorId: number,
  ): Promise<number[]> {
    const ids = await this.resolveGroupRecipients(guildId, creatorId);
    this.logger.debug(`Event ${eventId}: ${ids.length} group recipients`);
    return ids;
  }

  /** D6b: group-only fan-out for an already-announced, not-started event. */
  async notifyLateTag(eventId: number): Promise<void> {
    const event = await findLateTagEvent(this.db, eventId);
    if (!event || event.guildId === null || event.cancelledAt) return;
    if (event.startTime.getTime() <= Date.now()) return;
    if (!(await this.dedup.isMarked(`game-alert:event:${eventId}`))) return;
    const guildId = event.guildId;
    const guildName = (await findGuildName(this.db, guildId)) ?? 'your group';
    const ids = await this.resolveGroupEventRecipients(
      eventId,
      guildId,
      event.creatorId,
    );
    const payload = buildTaggedPayload(event, guildId, guildName);
    await Promise.allSettled(
      ids.map((userId) =>
        sendClaimedEventNotice(this.dedup, eventId, userId, () =>
          this.notificationService.create({
            userId,
            type: 'hub_event_tagged',
            title: event.title,
            message: `Tagged to ${guildName}`,
            payload,
          }),
        ),
      ),
    );
  }

  private async resolveGroupRecipients(
    guildId: number,
    actorId: number,
  ): Promise<number[]> {
    const adapter = await this.registry.forGuild(guildId);
    if (!adapter) return [];
    const members = await adapter.memberUserIds(guildId);
    const others = members.filter((id) => id !== actorId);
    return filterGroupRecipients(this.db, others, guildId);
  }
}

/** The `hub_event_tagged` payload (D5). */
export function buildTaggedPayload(
  event: Pick<LateTagEvent, 'id' | 'gameId' | 'startTime' | 'endTime'>,
  guildId: number,
  guildName: string,
): Record<string, unknown> {
  return {
    eventId: event.id,
    ...(event.gameId !== null ? { gameId: event.gameId } : {}),
    guildId,
    guildName,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    url: `/events/${event.id}`,
  };
}
