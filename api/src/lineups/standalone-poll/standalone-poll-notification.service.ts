/**
 * Notification service for standalone scheduling polls (ROK-977).
 * Sends DMs + channel embeds to game-interested users.
 *
 * Uses community_lineup notification type (not subscribed_game)
 * for consistency with existing lineup notifications. Distinguished
 * via payload.subtype = 'standalone_scheduling_poll'.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';

@Injectable()
export class StandalonePollNotificationService {
  private readonly logger = new Logger(StandalonePollNotificationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Notify game-interested users about a new scheduling poll.
   * Fire-and-forget — errors are logged, never thrown.
   */
  async notifyInterestedUsers(
    gameId: number,
    gameName: string,
    lineupId: number,
    matchId: number,
    creatorId: number,
    gameCoverUrl?: string | null,
  ): Promise<void> {
    try {
      const recipientIds = await this.findRecipients(gameId, creatorId);
      if (recipientIds.length === 0) return;
      const creatorName = await this.getCreatorName(creatorId);
      await this.dispatchNotifications(
        recipientIds,
        gameName,
        lineupId,
        matchId,
        creatorName,
        gameCoverUrl,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify interested users: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  /** DM a voter that a different timeslot was chosen (ROK-1031). */
  async notifyPollOutcome(
    userId: number,
    chosenTime: string,
    eventId: number,
  ): Promise<void> {
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: 'Scheduling poll result',
      message: `The poll chose **${chosenTime}**. You voted for a different time so you weren't auto-signed up — check the event if you'd still like to join!`,
      payload: { subtype: 'lineup_event_created', eventId },
    });
  }

  /** DM a voter that they were auto-signed up from a poll (ROK-1031). */
  async notifyAutoSignup(
    userId: number,
    gameName: string,
    eventTime: string,
    eventId: number,
  ): Promise<void> {
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: 'Auto-signed up',
      message: `You voted for **${eventTime}** — you've been automatically signed up for **${gameName}**!`,
      payload: { subtype: 'lineup_event_created', eventId },
    });
  }

  /** Find users with affinity for the game, excluding the creator. */
  private async findRecipients(
    gameId: number,
    creatorId: number,
  ): Promise<number[]> {
    const rows = await this.db.execute<{ id: number }>(sql`
      SELECT DISTINCT u.id FROM users u
      WHERE u.id != ${creatorId}
        AND (
          u.id IN (
            SELECT gi.user_id FROM game_interests gi
            WHERE gi.game_id = ${gameId}
          )
          OR
          u.id IN (
            SELECT es.user_id FROM event_signups es
            INNER JOIN events e ON e.id = es.event_id
            WHERE e.game_id = ${gameId}
              AND es.status = 'signed_up'
              AND e.cancelled_at IS NULL
              AND es.user_id IS NOT NULL
          )
        )
    `);
    return rows.map((r) => r.id);
  }

  /** Look up the creator's display name or username. */
  private async getCreatorName(creatorId: number): Promise<string> {
    const rows = await this.db.execute<{
      displayName: string | null;
      username: string | null;
    }>(sql`
      SELECT display_name AS "displayName", username
      FROM users WHERE id = ${creatorId} LIMIT 1
    `);
    const row = rows[0];
    return row?.displayName || row?.username || 'Someone';
  }

  /** Dispatch community_lineup notifications to recipients. */
  private async dispatchNotifications(
    recipientIds: number[],
    gameName: string,
    lineupId: number,
    matchId: number,
    creatorName: string,
    gameCoverUrl?: string | null,
  ): Promise<void> {
    const results = await Promise.allSettled(
      recipientIds.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'community_lineup',
          title: `Scheduling poll for ${gameName}`,
          message: `${creatorName} started a poll — set your availability so the group can find the best time to play.`,
          payload: {
            subtype: 'standalone_scheduling_poll',
            lineupId,
            matchId,
            gameName,
            creatorName,
            ...(gameCoverUrl ? { gameCoverUrl } : {}),
          },
        }),
      ),
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    this.logger.log(
      `Standalone poll notifications: ${sent}/${recipientIds.length} sent (match ${matchId})`,
    );
  }
}
