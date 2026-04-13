/**
 * Notification service for standalone scheduling polls (ROK-977 / ROK-1034).
 * Sends DMs + channel embeds to game-interested users.
 *
 * When a poll is linked to an event (rescheduling), roster members receive
 * a reschedule-specific notification while interest-only users receive the
 * generic poll notification. Dedup ensures roster members do not also get
 * the generic notification.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';

/** Notification payload for standalone scheduling polls. */
interface PollNotifPayload {
  subtype: string;
  lineupId: number;
  matchId: number;
  gameName: string;
  creatorName: string;
  gameCoverUrl?: string;
}

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
   * When linkedEventId is provided, roster members get a reschedule
   * notification while interest-only users get the generic one.
   * Fire-and-forget — errors are logged, never thrown.
   */
  async notifyInterestedUsers(
    gameId: number,
    gameName: string,
    lineupId: number,
    matchId: number,
    creatorId: number,
    gameCoverUrl?: string | null,
    linkedEventId?: number,
  ): Promise<void> {
    try {
      const allRecipientIds = await this.findRecipients(gameId, creatorId);
      if (allRecipientIds.length === 0) return;
      const creatorName = await this.getCreatorName(creatorId);
      const basePayload = this.buildBasePayload(
        lineupId,
        matchId,
        gameName,
        creatorName,
        gameCoverUrl,
      );
      await this.splitAndDispatch(
        allRecipientIds,
        gameName,
        basePayload,
        creatorName,
        linkedEventId,
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

  /** Find roster members for a linked event. */
  private async findRosterMembers(eventId: number): Promise<number[]> {
    const rows = await this.db.execute<{ userId: number }>(sql`
      SELECT es.user_id AS "userId"
      FROM event_signups es
      WHERE es.event_id = ${eventId}
        AND es.status IN ('signed_up', 'tentative')
        AND es.user_id IS NOT NULL
    `);
    return rows.map((r) => r.userId);
  }

  /** Fetch the start time of a linked event. */
  private async findEventStartTime(
    eventId: number,
  ): Promise<Date | undefined> {
    const rows = await this.db.execute<{ startTime: string }>(sql`
      SELECT lower(duration)::text AS "startTime"
      FROM events WHERE id = ${eventId} LIMIT 1
    `);
    const raw = rows[0]?.startTime;
    return raw ? new Date(raw.endsWith('Z') ? raw : raw + 'Z') : undefined;
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

  /** Build base notification payload. */
  private buildBasePayload(
    lineupId: number,
    matchId: number,
    gameName: string,
    creatorName: string,
    gameCoverUrl?: string | null,
  ): PollNotifPayload {
    return {
      subtype: 'standalone_scheduling_poll',
      lineupId,
      matchId,
      gameName,
      creatorName,
      ...(gameCoverUrl ? { gameCoverUrl } : {}),
    };
  }

  /** Split recipients and dispatch appropriate notifications. */
  private async splitAndDispatch(
    allRecipientIds: number[],
    gameName: string,
    basePayload: PollNotifPayload,
    creatorName: string,
    linkedEventId?: number,
  ): Promise<void> {
    if (!linkedEventId) {
      await this.dispatchGeneric(
        allRecipientIds,
        gameName,
        basePayload,
        creatorName,
      );
      return;
    }
    const [rosterIds, eventStartTime] = await Promise.all([
      this.findRosterMembers(linkedEventId),
      this.findEventStartTime(linkedEventId),
    ]);
    const rosterSet = new Set(rosterIds);
    const rosterRecipients = allRecipientIds.filter((id) => rosterSet.has(id));
    const genericRecipients = allRecipientIds.filter(
      (id) => !rosterSet.has(id),
    );

    const promises: Promise<void>[] = [];
    if (rosterRecipients.length > 0) {
      promises.push(
        this.dispatchReschedule(
          rosterRecipients,
          gameName,
          basePayload,
          creatorName,
          eventStartTime,
        ),
      );
    }
    if (genericRecipients.length > 0) {
      promises.push(
        this.dispatchGeneric(
          genericRecipients,
          gameName,
          basePayload,
          creatorName,
        ),
      );
    }
    await Promise.all(promises);
  }

  /** Dispatch generic poll notifications. */
  private async dispatchGeneric(
    recipientIds: number[],
    gameName: string,
    basePayload: PollNotifPayload,
    creatorName: string,
  ): Promise<void> {
    const results = await Promise.allSettled(
      recipientIds.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'community_lineup',
          title: `Scheduling poll for ${gameName}`,
          message: `${creatorName} started a poll — set your availability so the group can find the best time to play.`,
          payload: { ...basePayload, subtype: 'standalone_scheduling_poll' },
        }),
      ),
    );
    this.logResults(
      results,
      recipientIds.length,
      basePayload.matchId,
      'generic',
    );
  }

  /** Dispatch reschedule-specific notifications to roster members. */
  private async dispatchReschedule(
    recipientIds: number[],
    gameName: string,
    basePayload: PollNotifPayload,
    creatorName: string,
    eventStartTime?: Date,
  ): Promise<void> {
    const timeStr = eventStartTime
      ? ` (<t:${Math.floor(eventStartTime.getTime() / 1000)}:f>)`
      : '';
    const results = await Promise.allSettled(
      recipientIds.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'community_lineup',
          title: `Event being rescheduled — ${gameName}`,
          message: `The event you signed up for${timeStr} is being rescheduled — vote now to pick the next date.`,
          payload: { ...basePayload, subtype: 'event_rescheduling' },
        }),
      ),
    );
    this.logResults(
      results,
      recipientIds.length,
      basePayload.matchId,
      'reschedule',
    );
  }

  /** Log dispatch results. */
  private logResults(
    results: PromiseSettledResult<unknown>[],
    total: number,
    matchId: number,
    kind: string,
  ): void {
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    this.logger.log(
      `Standalone poll ${kind} notifications: ${sent}/${total} sent (match ${matchId})`,
    );
  }
}
