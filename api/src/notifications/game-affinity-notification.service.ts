import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';

/** TTL for game-alert dedup keys: 30 days in seconds */
const GAME_ALERT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface GameAffinityNotificationInput {
  eventId: number;
  eventTitle: string;
  gameName: string;
  gameId: number;
  startTime: string;
  creatorId: number;
  clientUrl?: string | null;
  /** ROK-504: Discord message info for "View in Discord" button */
  discordMessage?: {
    guildId: string;
    channelId: string;
    messageId: string;
  } | null;
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
    @Inject(REDIS_CLIENT)
    private redis: Redis,
    private readonly notificationService: NotificationService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Notify users with game affinity about a new event.
   * Idempotent per event via Redis dedup key.
   */
  async notifyGameAffinity(
    input: GameAffinityNotificationInput,
  ): Promise<void> {
    const dedupKey = `game-alert:event:${input.eventId}`;

    // Check if we already sent alerts for this event
    const alreadySent = await this.redis.get(dedupKey);
    if (alreadySent) {
      this.logger.debug(
        `Game affinity alerts already sent for event ${input.eventId}, skipping`,
      );
      return;
    }

    // Find recipients: users who hearted the game OR attended past events for this game
    let recipientIds = await this.findRecipients(input.gameId, input.creatorId);

    if (recipientIds.length === 0) {
      this.logger.debug(
        `No game affinity recipients for event ${input.eventId} (game ${input.gameId})`,
      );
      return;
    }

    // ROK-503: Skip users who have an active absence covering the event's start date
    const absentUserIds = await this.findAbsentUsers(
      recipientIds,
      input.startTime,
    );
    if (absentUserIds.size > 0) {
      recipientIds = recipientIds.filter((id) => !absentUserIds.has(id));
      this.logger.debug(
        `Excluded ${absentUserIds.size} absent users from game affinity alerts for event ${input.eventId}`,
      );
      if (recipientIds.length === 0) {
        this.logger.debug(
          `All recipients absent for event ${input.eventId}, skipping`,
        );
        return;
      }
    }

    // Mark as sent before dispatching to prevent duplicates on retries
    await this.redis.set(dedupKey, '1', 'EX', GAME_ALERT_TTL_SECONDS);

    // Format the event date for the notification message
    const defaultTimezone =
      (await this.settingsService.getDefaultTimezone()) ?? 'UTC';
    const eventDate = new Date(input.startTime).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: defaultTimezone,
    });

    const message = `New event for ${input.gameName}: ${input.eventTitle} on ${eventDate}`;
    const eventUrl = input.clientUrl
      ? `${input.clientUrl}/events/${input.eventId}`
      : null;

    // ROK-504: Build Discord channel URL if message info is available
    const discordUrl = input.discordMessage
      ? `https://discord.com/channels/${input.discordMessage.guildId}/${input.discordMessage.channelId}/${input.discordMessage.messageId}`
      : null;

    // ROK-507: Resolve voice channel for the event's game
    const voiceChannelId = await this.notificationService.resolveVoiceChannelId(
      input.gameId,
    );

    // Dispatch notifications in parallel (NotificationService handles prefs + Discord DM)
    const results = await Promise.allSettled(
      recipientIds.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'subscribed_game',
          title: `New ${input.gameName} Event`,
          message,
          payload: {
            eventId: input.eventId,
            gameId: input.gameId,
            startTime: input.startTime,
            ...(eventUrl ? { url: eventUrl } : {}),
            ...(discordUrl ? { discordUrl } : {}),
            ...(voiceChannelId ? { voiceChannelId } : {}),
          },
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    this.logger.log(
      `Game affinity notifications for event ${input.eventId}: ${succeeded} sent, ${failed} failed (${recipientIds.length} recipients)`,
    );
  }

  /**
   * Find users with affinity for a game, excluding the event creator.
   * Union of: users who hearted the game + users who signed up for past events of that game.
   */
  private async findRecipients(
    gameId: number,
    creatorId: number,
  ): Promise<number[]> {
    const rows = await this.db.execute<{ id: number }>(sql`
      SELECT DISTINCT u.id FROM users u
      WHERE u.id != ${creatorId}
        AND (
          u.id IN (
            SELECT gi.user_id FROM game_interests gi WHERE gi.game_id = ${gameId}
          )
          OR
          u.id IN (
            SELECT es.user_id FROM event_signups es
            INNER JOIN events e ON e.id = es.event_id
            WHERE e.game_id = ${gameId}
              AND upper(e.duration) < NOW()::timestamp
              AND es.status = 'signed_up'
              AND e.cancelled_at IS NULL
              AND es.user_id IS NOT NULL
          )
        )
    `);

    return rows.map((r) => r.id);
  }

  /**
   * ROK-503: Find users from the candidate list who have an absence covering the event date.
   * Checks game_time_absences where the event's start date falls within [start_date, end_date].
   */
  private async findAbsentUsers(
    userIds: number[],
    startTime: string,
  ): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();

    const eventDate = new Date(startTime).toISOString().split('T')[0];
    const rows = await this.db.execute<{ user_id: number }>(sql`
      SELECT DISTINCT a.user_id
      FROM game_time_absences a
      WHERE a.user_id = ANY(${userIds})
        AND ${eventDate} >= a.start_date
        AND ${eventDate} <= a.end_date
    `);

    return new Set(rows.map((r) => r.user_id));
  }
}
