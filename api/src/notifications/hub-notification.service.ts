import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { HubKindRegistry } from '../guilds/hub-kind.registry';
import { gmPostHeadline } from '../guilds/guild-profile.queries';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import {
  EVENT_NOTICE_TTL_SECONDS,
  eventAnnounceKey,
  eventNoticeKey,
  sendClaimedEventNotice,
} from './event-notice-plan.helpers';
import { findAbsentUserIds } from './game-affinity-recipients.helpers';
import {
  HUB_NOTIFICATION_EVENTS,
  HUB_POST_COOLDOWN_SECONDS,
  type LeaderPostInput,
} from './hub-notification.constants';
import {
  filterGroupRecipients,
  findGuildName,
  findLateTagEvent,
  findPriorEventNoticeUserIds,
  hasPostedEmbed,
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

  /**
   * D3 + D7: notify the group's members that a leader posted (ROK-1868: once
   * per NEW post, still under the hourly cooldown). Dedup rule (§2.5): this
   * fan-out NEVER posts to a channel — the channel copy is the post relay
   * (`HubPostRelayService`), its Discord leg is the per-user DM. Recipients
   * resolve first; the cooldown is claimed just before sending and given
   * back when nothing was delivered, so a failure never mutes the next post.
   */
  async notifyLeaderPost(input: LeaderPostInput): Promise<void> {
    const headline = gmPostHeadline(input.body);
    if (!headline) return;
    const guildName =
      (await findGuildName(this.db, input.guildId)) ?? 'your group';
    const ids = await this.resolveGroupRecipients(input.guildId, input.actorId);
    const key = `hub-post:${input.guildId}`;
    if (await this.dedup.checkAndMarkSent(key, HUB_POST_COOLDOWN_SECONDS)) {
      return;
    }
    try {
      const url = `/guilds/${input.guildId}?post=${input.postId}#posts`;
      const delivered = await this.sendLeaderPost(
        ids,
        { guildId: input.guildId, guildName, url },
        headline,
      );
      if (ids.length > 0 && delivered === 0) await this.dedup.releaseKey(key);
    } catch (err: unknown) {
      await this.dedup.releaseKey(key);
      throw err;
    }
  }

  /** Send the leader-post notice to each id; resolves to the count actually stored. */
  private async sendLeaderPost(
    ids: number[],
    payload: { guildId: number; guildName: string; url: string },
    headline: string,
  ): Promise<number> {
    const results = await Promise.allSettled(
      ids.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'hub_leader_post',
          title: `New post in ${payload.guildName}`,
          message: headline,
          payload,
        }),
      ),
    );
    // `create` resolves null for an opted-out recipient: not a delivery.
    return results.filter((r) => r.status === 'fulfilled' && r.value !== null)
      .length;
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

  /**
   * D6b: group-only fan-out for an already-announced, not-started event, with
   * the announce path's exclusions: ROK-503 absences here, and ROK-1371
   * follow-up attendees through the per-user notice keys the announce claimed
   * (plus the notices stored before those keys existed).
   */
  async notifyLateTag(eventId: number): Promise<void> {
    const event = await findLateTagEvent(this.db, eventId);
    if (!event || event.guildId === null || event.cancelledAt) return;
    if (event.startTime.getTime() <= Date.now()) return;
    if (!(await this.isAnnounced(eventId))) return;
    const guildId = event.guildId;
    const guildName = (await findGuildName(this.db, guildId)) ?? 'your group';
    const present = await this.presentOn(
      await this.resolveGroupEventRecipients(eventId, guildId, event.creatorId),
      event.startTime,
    );
    const ids = await this.withoutPriorNotice(eventId, present);
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

  /**
   * Announced by the create/publish path (full marker), the scheduler's
   * group-only send when no embed could post (Codex r8: group-only marker),
   * or the deferred-embed scheduler (posted embed).
   */
  private async isAnnounced(eventId: number): Promise<boolean> {
    for (const groupOnly of [false, true]) {
      const key = eventAnnounceKey(eventId, groupOnly);
      if (await this.dedup.isMarked(key)) return true;
    }
    return hasPostedEmbed(this.db, eventId);
  }

  /**
   * Drop users who already hold a notice row for the event and claim their
   * per-user key, so notices sent before the claims existed still dedupe.
   */
  private async withoutPriorNotice(
    eventId: number,
    ids: number[],
  ): Promise<number[]> {
    const prior = await findPriorEventNoticeUserIds(this.db, eventId, ids);
    await Promise.allSettled(
      [...prior].map((id) =>
        this.dedup.checkAndMarkSent(
          eventNoticeKey(eventId, id),
          EVENT_NOTICE_TTL_SECONDS,
        ),
      ),
    );
    return ids.filter((id) => !prior.has(id));
  }

  /** ROK-503: drop the users with an absence covering the event date. */
  private async presentOn(ids: number[], start: Date): Promise<number[]> {
    if (ids.length === 0) return ids;
    const away = await findAbsentUserIds(this.db, ids, start.toISOString());
    return ids.filter((id) => !away.has(id));
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
