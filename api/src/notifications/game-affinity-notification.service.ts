import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';

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
    const recipientIds = await this.findRecipients(
      input.gameId,
      input.creatorId,
    );

    if (recipientIds.length === 0) {
      this.logger.debug(
        `No game affinity recipients for event ${input.eventId} (game ${input.gameId})`,
      );
      return;
    }

    // Mark as sent before dispatching to prevent duplicates on retries
    await this.redis.set(dedupKey, '1', 'EX', GAME_ALERT_TTL_SECONDS);

    // Format the event date for the notification message
    const eventDate = new Date(input.startTime).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    const message = `New event for ${input.gameName}: ${input.eventTitle} on ${eventDate}`;
    const eventUrl = input.clientUrl
      ? `${input.clientUrl}/events/${input.eventId}`
      : null;

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
            ...(eventUrl ? { url: eventUrl } : {}),
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
}
