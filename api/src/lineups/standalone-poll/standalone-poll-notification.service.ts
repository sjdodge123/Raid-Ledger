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
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { findStandalonePollRecipients } from './standalone-poll-recipients.helpers';
import {
  findCreatorName,
  splitRoster,
  type RosterSplit,
} from './standalone-poll-notification.queries';
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
   *
   * @param excludeUserIds - ROK-1371: recipients already DM'd by the targeted
   *   post-event follow-up fan-out, subtracted so an attendee never gets both
   *   the follow-up vote DM AND this generic broadcast. Defaults to empty (a
   *   no-op) so regular standalone polls are unaffected.
   */
  async notifyInterestedUsers(
    gameId: number,
    gameName: string,
    lineupId: number,
    matchId: number,
    creatorId: number,
    gameCoverUrl?: string | null,
    linkedEventId?: number,
    excludeUserIds: number[] = [],
  ): Promise<void> {
    try {
      const excluded = new Set(excludeUserIds);
      const allRecipientIds = (
        await findStandalonePollRecipients(this.db, gameId, creatorId)
      ).filter((id) => !excluded.has(id));
      if (allRecipientIds.length === 0) return;
      const creatorName = await findCreatorName(this.db, creatorId);
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

  /**
   * ROK-1893 P3: the roster half of `notifyInterestedUsers` alone — the
   * reschedule DM to the linked event's roster, nobody else. A hub-tagged
   * reschedule poll skips the generic interest broadcast but its roster must
   * still hear the event is moving. Same recipient rules (mutes, creator
   * excluded). Never throws; resolves to the ids it DM'd.
   */
  async notifyRosterReschedule(
    game: { id: number; name: string; coverUrl?: string | null },
    ids: { lineupId: number; matchId: number; creatorId: number },
    linkedEventId: number,
  ): Promise<number[]> {
    try {
      const recipients = await findStandalonePollRecipients(
        this.db,
        game.id,
        ids.creatorId,
      );
      const split = await splitRoster(this.db, recipients, linkedEventId);
      if (split.roster.length === 0) return [];
      const creatorName = await findCreatorName(this.db, ids.creatorId);
      const payload = this.buildBasePayload(
        ids.lineupId,
        ids.matchId,
        game.name,
        creatorName,
        game.coverUrl,
      );
      await this.dispatchRosterSplit(split, game.name, payload, creatorName);
      return split.roster;
    } catch (error) {
      this.logger.error(
        `Failed to notify reschedule roster: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  /**
   * ROK-1750: a private poll is never broadcast — DM only the members the
   * creator picked (creator excluded). Fire-and-forget, never throws.
   */
  async notifyPickedMembers(
    recipientIds: number[],
    gameName: string,
    ids: { lineupId: number; matchId: number; creatorId: number },
    gameCoverUrl?: string | null,
  ): Promise<void> {
    try {
      const recipients = recipientIds.filter((id) => id !== ids.creatorId);
      if (recipients.length === 0) return;
      const creatorName = await findCreatorName(this.db, ids.creatorId);
      const payload = this.buildBasePayload(
        ids.lineupId,
        ids.matchId,
        gameName,
        creatorName,
        gameCoverUrl,
      );
      await this.dispatchGeneric(recipients, gameName, payload, creatorName);
    } catch (error) {
      this.logger.error(
        `Failed to notify picked poll members: ${error instanceof Error ? error.message : 'Unknown'}`,
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

  /**
   * DM a voter that their poll auto-signup landed on the bench because the
   * roster was full (ROK-1874). Same type + payload as `notifyAutoSignup`.
   */
  async notifyAutoBenched(
    userId: number,
    gameName: string,
    eventTime: string,
    eventId: number,
  ): Promise<void> {
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: 'On the bench',
      message: `You voted for **${eventTime}** — you've been signed up for **${gameName}**, but the roster was full, so you're on the bench for now.`,
      payload: { subtype: 'lineup_event_created', eventId },
    });
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
    const split = await splitRoster(this.db, allRecipientIds, linkedEventId);
    const genericRecipients = allRecipientIds.filter(
      (id) => !split.roster.includes(id),
    );
    const promises: Promise<void>[] = [
      this.dispatchRosterSplit(split, gameName, basePayload, creatorName),
    ];
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

  /** The roster half of a reschedule poll's fan-out (no-op when empty). */
  private async dispatchRosterSplit(
    split: RosterSplit,
    gameName: string,
    basePayload: PollNotifPayload,
    creatorName: string,
  ): Promise<void> {
    if (split.roster.length === 0) return;
    await this.dispatchReschedule(
      split.roster,
      gameName,
      basePayload,
      creatorName,
      split.eventStartTime,
    );
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
