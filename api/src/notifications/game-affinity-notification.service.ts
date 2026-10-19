import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import { HubNotificationService } from './hub-notification.service';
import {
  loadGroupNoticeContext,
  sendEventNotices,
  type GroupNoticeContext,
} from './event-notice-dispatch.helpers';
import { resolvePostEventFollowupRecipients } from './post-event-followup.helpers';
import { findEventGuildId } from './hub-notification.queries';
import {
  findAbsentUserIds,
  findGameAffinityRecipients,
} from './game-affinity-recipients.helpers';

/** TTL for game-alert dedup keys: 30 days in seconds */
const GAME_ALERT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface GameAffinityNotificationInput {
  eventId: number;
  eventTitle: string;
  /** Null for a game-less event; only the group path (D6a) can then send. */
  gameName: string | null;
  gameId: number | null;
  startTime: string;
  endTime: string;
  creatorId: number;
  clientUrl?: string | null;
  gameCoverUrl?: string | null;
  /** ROK-504: Discord message info for "View in Discord" button */
  discordMessage?: {
    guildId: string;
    channelId: string;
    messageId: string;
  } | null;
  /**
   * ROK-1371: when this event was scheduled as a post-event follow-up, the id
   * of the ended event. Its attendees already got the targeted quick-sign-up
   * DM, so they are subtracted from this affinity broadcast to avoid a double DM.
   */
  followupForEventId?: number | null;
}

/**
 * Notifies users with affinity for a game when a new event embed is posted (ROK-440).
 * Recipients: union of users who hearted the game + users who signed up for past events of that game.
 * Excludes the event creator. Deduplicates via Redis per event.
 */
@Injectable()
export class GameAffinityNotificationService {
  private readonly logger = new Logger(GameAffinityNotificationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly hubNotifications: HubNotificationService,
  ) {}

  /**
   * Notify users with game affinity about a new event.
   * Idempotent per event via Redis dedup key.
   */
  async notifyGameAffinity(
    input: GameAffinityNotificationInput,
  ): Promise<void> {
    if (await this.hasNoAudienceSource(input)) return;
    const dedupKey = `game-alert:event:${input.eventId}`;
    const alreadySent = await this.dedupService.checkAndMarkSent(
      dedupKey,
      GAME_ALERT_TTL_SECONDS,
    );
    if (alreadySent) {
      this.logger.debug(
        `Game affinity alerts already sent for event ${input.eventId}, skipping`,
      );
      return;
    }
    const plan = await this.collectRecipients(input);
    if (!plan) return;
    await this.dispatchAffinityNotifications(
      input,
      plan.affinityIds,
      plan.group,
    );
  }

  /** A game-less event with no group tag has nobody to notify (no claim). */
  private async hasNoAudienceSource(
    input: GameAffinityNotificationInput,
  ): Promise<boolean> {
    if (input.gameId !== null) return false;
    return (await findEventGuildId(this.db, input.eventId)) === null;
  }

  /**
   * ROK-1832 D6a: game-affinity ∪ group recipients (guild read at send time),
   * minus absences and follow-up attendees. Null when nobody is left.
   */
  private async collectRecipients(
    input: GameAffinityNotificationInput,
  ): Promise<{
    affinityIds: number[];
    group: GroupNoticeContext | null;
  } | null> {
    const affinity = await this.findRecipients(input.gameId, input.creatorId);
    const group = await loadGroupNoticeContext(
      this.db,
      this.hubNotifications,
      input.eventId,
      input.creatorId,
    );
    const all = [...new Set([...affinity, ...(group?.groupIds ?? [])])];
    const kept = new Set(await this.excludeRecipients(all, input));
    if (kept.size === 0) {
      this.logger.debug(
        `No event-notice recipients for event ${input.eventId}`,
      );
      return null;
    }
    const keep = (ids: number[]): number[] => ids.filter((id) => kept.has(id));
    const scoped = group && { ...group, groupIds: keep(group.groupIds) };
    return { affinityIds: keep(affinity), group: scoped };
  }

  /** ROK-503 absences + ROK-1371 follow-up attendees, for both sources. */
  private async excludeRecipients(
    recipientIds: number[],
    input: GameAffinityNotificationInput,
  ): Promise<number[]> {
    if (recipientIds.length === 0) return [];
    const present = await this.excludeAbsentUsers(recipientIds, input);
    return this.excludeFollowupRecipients(present, input);
  }

  /**
   * ROK-1371: exclude the ended event's attendees when this event is a
   * post-event follow-up — they already receive the targeted quick-sign-up DM,
   * so the affinity broadcast would be a duplicate. No-op for normal events
   * (`followupForEventId` unset).
   */
  private async excludeFollowupRecipients(
    recipientIds: number[],
    input: GameAffinityNotificationInput,
  ): Promise<number[]> {
    if (input.followupForEventId == null || recipientIds.length === 0) {
      return recipientIds;
    }
    const followupIds = new Set(
      await resolvePostEventFollowupRecipients(
        this.db,
        input.followupForEventId,
        input.creatorId,
      ),
    );
    if (followupIds.size === 0) return recipientIds;
    return recipientIds.filter((id) => !followupIds.has(id));
  }

  /** Exclude users with active absences covering the event date. */
  private async excludeAbsentUsers(
    recipientIds: number[],
    input: GameAffinityNotificationInput,
  ): Promise<number[]> {
    const absentUserIds = await this.findAbsentUsers(
      recipientIds,
      input.startTime,
    );
    if (absentUserIds.size > 0) {
      this.logger.debug(
        `Excluded ${absentUserIds.size} absent users from game affinity alerts for event ${input.eventId}`,
      );
      return recipientIds.filter((id) => !absentUserIds.has(id));
    }
    return recipientIds;
  }

  /**
   * ROK-1832 D4/D5: one notice per (user, event) — the group copy for group
   * members, the game copy for the rest — each behind its per-user claim.
   */
  private async dispatchAffinityNotifications(
    input: GameAffinityNotificationInput,
    affinityIds: number[],
    group: GroupNoticeContext | null,
  ): Promise<void> {
    const payload = await this.buildAffinityPayload(input);
    const results = await sendEventNotices(
      { notifications: this.notificationService, dedup: this.dedupService },
      {
        eventId: input.eventId,
        title: input.eventTitle,
        gameName: input.gameName ?? 'this game',
        payload,
      },
      affinityIds,
      group,
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    this.logger.log(
      `Event notices for event ${input.eventId}: ${results.length - failed} settled, ${failed} failed`,
    );
  }

  /** Build the notification payload with optional URLs and voice channel. */
  private async buildAffinityPayload(
    input: GameAffinityNotificationInput,
  ): Promise<Record<string, unknown>> {
    const eventUrl = input.clientUrl
      ? `${input.clientUrl}/events/${input.eventId}`
      : null;
    const discordUrl = input.discordMessage
      ? `https://discord.com/channels/${input.discordMessage.guildId}/${input.discordMessage.channelId}/${input.discordMessage.messageId}`
      : null;
    const voiceChannelId =
      await this.notificationService.resolveVoiceChannelForEvent(input.eventId);
    return {
      eventId: input.eventId,
      gameId: input.gameId,
      gameName: input.gameName,
      startTime: input.startTime,
      endTime: input.endTime,
      ...(input.gameCoverUrl ? { gameCoverUrl: input.gameCoverUrl } : {}),
      ...(eventUrl ? { url: eventUrl } : {}),
      ...(discordUrl ? { discordUrl } : {}),
      ...(voiceChannelId ? { voiceChannelId } : {}),
    };
  }

  /**
   * Find users with affinity for a game, excluding the event creator
   * (none for a game-less event).
   * Union of: users who hearted the game + users who signed up for past events of that game.
   */
  private async findRecipients(
    gameId: number | null,
    creatorId: number,
  ): Promise<number[]> {
    if (gameId === null) return [];
    return findGameAffinityRecipients(this.db, gameId, {
      excludeUserId: creatorId,
    });
  }

  /**
   * ROK-503: Find users from the candidate list who have an absence covering the event date.
   * Checks game_time_absences where the event's start date falls within [start_date, end_date].
   */
  private async findAbsentUsers(
    userIds: number[],
    startTime: string,
  ): Promise<Set<number>> {
    return findAbsentUserIds(this.db, userIds, startTime);
  }
}
