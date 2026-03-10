import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import {
  PRESENCE_THRESHOLD_SEC,
  PHASE1_OFFSET_MS,
  PHASE2_OFFSET_MS,
  type LiveEvent,
  findLiveEventsInNoShowWindow,
  getAbsentSignedUpPlayers,
  getPhase1RemindedUserIds,
  batchFetchPlayerDisplayInfo,
  fetchPhase2Data,
} from './live-noshow.helpers';

/**
 * Live no-show detection service (ROK-588).
 * Phase 1 (startTime + 5 min): DM absent players a reminder to join voice.
 * Phase 2 (startTime + 15 min): DM the event creator listing absent players.
 */
@Injectable()
export class LiveNoShowService {
  private readonly logger = new Logger(LiveNoShowService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly cronJobService: CronJobService,
    @Optional()
    @Inject(VoiceAttendanceService)
    private readonly voiceAttendance: VoiceAttendanceService | null,
  ) {}

  /** Cron: runs every 60 seconds at second 40. */
  @Cron('40 */1 * * * *', { name: 'LiveNoShowService_checkNoShows' })
  async checkNoShows(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'LiveNoShowService_checkNoShows',
      async () => {
        if (!this.voiceAttendance) return false;
        const now = new Date();
        const liveEvents = await findLiveEventsInNoShowWindow(this.db, now);
        if (liveEvents.length === 0) return false;
        for (const event of liveEvents) {
          const msSinceStart = now.getTime() - event.startTime.getTime();
          if (msSinceStart >= PHASE2_OFFSET_MS) await this.checkPhase2(event);
          if (msSinceStart >= PHASE1_OFFSET_MS) await this.checkPhase1(event);
        }
      },
    );
  }

  /** Send a single Phase 1 no-show reminder. */
  private async sendPhase1Reminder(
    event: LiveEvent,
    userId: number,
    voiceChannelId: string | null,
  ): Promise<void> {
    if (!(await this.insertReminderDedup(event.id, userId, 'noshow_reminder')))
      return;
    await this.notificationService.create({
      userId,
      type: 'event_reminder',
      title: 'Are you joining?',
      message: `Your event **${event.title}** started 5 minutes ago — hop in the voice channel!`,
      payload: {
        eventId: event.id,
        startTime: event.startTime.toISOString(),
        voiceChannelId,
        noshowReminder: true,
      },
    });
    this.logger.debug(
      `Phase 1: Sent no-show reminder to user ${userId} for event ${event.id}`,
    );
  }

  /** Phase 1: Send reminder DM to absent signed-up players. */
  private async checkPhase1(event: LiveEvent): Promise<void> {
    const absentPlayers = await getAbsentSignedUpPlayers(
      this.db,
      event.id,
      (eid, did) => this.voiceAttendance!.isUserActive(eid, did),
    );
    if (absentPlayers.length === 0) return;
    const voiceChannelId =
      await this.notificationService.resolveVoiceChannelForEvent(event.id);
    for (const player of absentPlayers) {
      if (!player.userId) continue;
      await this.sendPhase1Reminder(event, player.userId, voiceChannelId);
    }
  }

  /** Phase 2: Batch DM the creator about still-absent players. */
  private async checkPhase2(event: LiveEvent): Promise<void> {
    if (
      await this.hasReminderBeenSent(
        event.id,
        event.creatorId,
        'noshow_escalation',
      )
    )
      return;
    const phase1Reminded = await getPhase1RemindedUserIds(this.db, event.id);
    if (phase1Reminded.length === 0) return;
    const stillAbsent = await this.findStillAbsentPlayers(
      event,
      phase1Reminded,
    );
    if (stillAbsent.length === 0) return;
    await this.insertReminderDedup(
      event.id,
      event.creatorId,
      'noshow_escalation',
    );
    await this.sendEscalationNotification(event, stillAbsent);
  }

  /** Send the escalation notification to the event creator. */
  private async sendEscalationNotification(
    event: LiveEvent,
    stillAbsent: Array<{
      userId: number;
      displayName: string;
      role: string | null;
    }>,
  ): Promise<void> {
    const message = this.buildEscalationMessage(event.title, stillAbsent);
    await this.notificationService.create({
      userId: event.creatorId,
      type: 'missed_event_nudge',
      title: 'No-show Alert',
      message,
      payload: {
        eventId: event.id,
        eventTitle: event.title,
        absentPlayers: stillAbsent.map((p) => ({
          userId: p.userId,
          displayName: p.displayName,
          role: p.role,
        })),
      },
    });
    this.logger.log(
      `Phase 2: Notified creator (user ${event.creatorId}) about ${stillAbsent.length} no-show(s) for event ${event.id}`,
    );
  }

  /** Find players who were reminded in Phase 1 but still have no voice presence. */
  private async findStillAbsentPlayers(
    event: LiveEvent,
    phase1Reminded: number[],
  ): Promise<
    Array<{ userId: number; displayName: string; role: string | null }>
  > {
    const { discordIdByUserId, voiceSessionByDiscordId } =
      await fetchPhase2Data(this.db, event.id, phase1Reminded);
    const absentUserIds: number[] = [];
    for (const userId of phase1Reminded) {
      const discordId = discordIdByUserId.get(userId);
      if (discordId) {
        if (this.voiceAttendance!.isUserActive(event.id, discordId)) continue;
        const totalDuration = voiceSessionByDiscordId.get(discordId) ?? 0;
        if (totalDuration >= PRESENCE_THRESHOLD_SEC) continue;
      }
      absentUserIds.push(userId);
    }
    if (absentUserIds.length === 0) return [];
    const displayInfoMap = await batchFetchPlayerDisplayInfo(
      this.db,
      event.id,
      absentUserIds,
    );
    return absentUserIds.map((userId) => {
      const info = displayInfoMap.get(userId)!;
      return { userId, displayName: info.displayName, role: info.role };
    });
  }

  /** Build escalation message for the creator. */
  private buildEscalationMessage(
    eventTitle: string,
    stillAbsent: Array<{ displayName: string; role: string | null }>,
  ): string {
    if (stillAbsent.length === 1) {
      const p = stillAbsent[0];
      return `${p.displayName} hasn't shown up for **${eventTitle}** \u2014 their${p.role ? ` ${p.role}` : ''} slot is available to PUG.`;
    }
    const lines = stillAbsent.map(
      (p) => `- **${p.displayName}**${p.role ? ` (${p.role})` : ''}`,
    );
    return `${stillAbsent.length} players haven't shown up for **${eventTitle}**:\n${lines.join('\n')}\n\nTheir slots are available to PUG.`;
  }

  /** Check if a specific reminder has already been sent. */
  private async hasReminderBeenSent(
    eventId: number,
    userId: number,
    reminderType: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.eventRemindersSent.id })
      .from(schema.eventRemindersSent)
      .where(
        and(
          eq(schema.eventRemindersSent.eventId, eventId),
          eq(schema.eventRemindersSent.userId, userId),
          eq(schema.eventRemindersSent.reminderType, reminderType),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** Insert a dedup record. Returns true if inserted (first time). */
  private async insertReminderDedup(
    eventId: number,
    userId: number,
    reminderType: string,
  ): Promise<boolean> {
    const result = await this.db
      .insert(schema.eventRemindersSent)
      .values({ eventId, userId, reminderType })
      .onConflictDoNothing({
        target: [
          schema.eventRemindersSent.eventId,
          schema.eventRemindersSent.userId,
          schema.eventRemindersSent.reminderType,
        ],
      })
      .returning();
    return result.length > 0;
  }
}
