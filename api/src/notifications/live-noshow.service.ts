import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

/** Minimum voice presence (seconds) to count as "showed up". */
const PRESENCE_THRESHOLD_SEC = 120;

/** Phase 1 fires at startTime + 5 minutes. */
const PHASE1_OFFSET_MS = 5 * 60 * 1000;

/** Phase 2 fires at startTime + 15 minutes. */
const PHASE2_OFFSET_MS = 15 * 60 * 1000;

/**
 * Live no-show detection service (ROK-588).
 *
 * During a live scheduled event, monitors voice channel presence for registered
 * attendees. Two phases:
 *
 * Phase 1 (startTime + 5 min): DM absent players a reminder to join voice.
 * Phase 2 (startTime + 15 min): DM the event creator listing absent players
 *   whose slots are available to PUG.
 */
@Injectable()
export class LiveNoShowService {
  private readonly logger = new Logger(LiveNoShowService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly cronJobService: CronJobService,
    @Optional()
    @Inject(VoiceAttendanceService)
    private readonly voiceAttendance: VoiceAttendanceService | null,
  ) {}

  /**
   * Cron: runs every 60 seconds at second 40.
   * Stagger: second 40 avoids collision with GameActivityService_sweepStaleSessions (second 30).
   */
  @Cron('40 */1 * * * *', { name: 'LiveNoShowService_checkNoShows' })
  async checkNoShows(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'LiveNoShowService_checkNoShows',
      async () => {
        if (!this.voiceAttendance) {
          return;
        }

        const now = new Date();
        const liveEvents = await this.findLiveEventsInNoShowWindow(now);

        if (liveEvents.length === 0) return;

        for (const event of liveEvents) {
          const startTime = event.startTime;
          const msSinceStart = now.getTime() - startTime.getTime();

          // Phase 2: >= 15 min after start
          if (msSinceStart >= PHASE2_OFFSET_MS) {
            await this.checkPhase2(event);
          }

          // Phase 1: >= 5 min after start (always run — sends reminder to anyone not yet reminded)
          if (msSinceStart >= PHASE1_OFFSET_MS) {
            await this.checkPhase1(event);
          }
        }
      },
    );
  }

  /**
   * Find live scheduled events where now >= startTime + 5 min and the event
   * has not ended or been cancelled. Excludes ad-hoc events.
   */
  private async findLiveEventsInNoShowWindow(now: Date): Promise<
    Array<{
      id: number;
      title: string;
      creatorId: number;
      startTime: Date;
      endTime: Date;
      gameId: number | null;
    }>
  > {
    // Events where: not ad-hoc, not cancelled, started at least 5 min ago,
    // effective end (or extendedUntil) is still in the future
    const phase1Threshold = new Date(now.getTime() - PHASE1_OFFSET_MS);

    const rows = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        creatorId: schema.events.creatorId,
        gameId: schema.events.gameId,
        duration: schema.events.duration,
      })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.isAdHoc, false),
          sql`${schema.events.cancelledAt} IS NULL`,
          // Event started at least 5 min ago
          sql`lower(${schema.events.duration}) <= ${phase1Threshold.toISOString()}::timestamptz`,
          // Event hasn't ended yet (effective end is still in the future)
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      creatorId: r.creatorId,
      gameId: r.gameId,
      startTime: r.duration[0],
      endTime: r.duration[1],
    }));
  }

  /**
   * Phase 1: For each signed_up player who hasn't been in voice for >= threshold,
   * send them a reminder DM. Uses event_reminders_sent for dedup.
   */
  private async checkPhase1(event: {
    id: number;
    title: string;
    creatorId: number;
    startTime: Date;
    endTime: Date;
    gameId: number | null;
  }): Promise<void> {
    const absentPlayers = await this.getAbsentSignedUpPlayers(event.id);
    if (absentPlayers.length === 0) return;

    // Resolve voice channel for the event's game
    const voiceChannelId = await this.resolveVoiceChannelId(event.gameId);

    for (const player of absentPlayers) {
      if (!player.userId) continue; // Skip anonymous signups for Phase 1 DMs

      // Dedup: insert reminder tracking row
      const inserted = await this.insertReminderDedup(
        event.id,
        player.userId,
        'noshow_reminder',
      );
      if (!inserted) continue; // Already sent

      await this.notificationService.create({
        userId: player.userId,
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
        `Phase 1: Sent no-show reminder to user ${player.userId} for event ${event.id}`,
      );
    }
  }

  /**
   * Phase 2: For players who were reminded in Phase 1 and still have no voice
   * activity, batch a single DM to the event creator listing absent players
   * and their roles.
   */
  private async checkPhase2(event: {
    id: number;
    title: string;
    creatorId: number;
    startTime: Date;
    endTime: Date;
    gameId: number | null;
  }): Promise<void> {
    // Check if we already sent the creator escalation for this event
    const alreadyEscalated = await this.hasReminderBeenSent(
      event.id,
      event.creatorId,
      'noshow_escalation',
    );
    if (alreadyEscalated) return;

    // Find players who were reminded in Phase 1
    const phase1Reminded = await this.getPhase1RemindedUserIds(event.id);
    if (phase1Reminded.length === 0) return;

    // Re-check voice presence for these players
    const stillAbsent: Array<{
      userId: number;
      displayName: string;
      role: string | null;
    }> = [];

    for (const userId of phase1Reminded) {
      const isPresent = await this.checkVoicePresence(event.id, userId);
      if (isPresent) continue;

      // Look up display name and role
      const playerInfo = await this.getPlayerDisplayInfo(event.id, userId);
      stillAbsent.push({
        userId,
        displayName: playerInfo.displayName,
        role: playerInfo.role,
      });
    }

    if (stillAbsent.length === 0) return;

    // Build batched message for the creator
    const playerLines = stillAbsent.map((p) => {
      const roleLabel = p.role ? ` (${p.role})` : '';
      return `- **${p.displayName}**${roleLabel}`;
    });

    const message =
      stillAbsent.length === 1
        ? `${stillAbsent[0].displayName} hasn't shown up for **${event.title}** \u2014 their${stillAbsent[0].role ? ` ${stillAbsent[0].role}` : ''} slot is available to PUG.`
        : `${stillAbsent.length} players haven't shown up for **${event.title}**:\n${playerLines.join('\n')}\n\nTheir slots are available to PUG.`;

    // Insert dedup for the escalation
    await this.insertReminderDedup(
      event.id,
      event.creatorId,
      'noshow_escalation',
    );

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

  /**
   * Get signed_up players for the event who have no meaningful voice presence.
   */
  private async getAbsentSignedUpPlayers(eventId: number): Promise<
    Array<{
      userId: number | null;
      discordUserId: string | null;
      discordUsername: string | null;
    }>
  > {
    // Get all signups with status = 'signed_up' (exclude tentative, declined, roached_out, departed)
    const signups = await this.db
      .select({
        userId: schema.eventSignups.userId,
        discordUserId: schema.eventSignups.discordUserId,
        discordUsername: schema.eventSignups.discordUsername,
      })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.status, 'signed_up'),
        ),
      );

    const absent: typeof signups = [];

    for (const signup of signups) {
      // Fall back to users.discordId when signup doesn't have a discordUserId
      let discordUserId = signup.discordUserId;
      if (!discordUserId && signup.userId) {
        const [user] = await this.db
          .select({ discordId: schema.users.discordId })
          .from(schema.users)
          .where(eq(schema.users.id, signup.userId))
          .limit(1);
        discordUserId = user?.discordId ?? null;
      }
      if (!discordUserId) continue; // No Discord ID anywhere — can't check voice

      // Check voice presence via in-memory sessions
      const hasPresence = this.voiceAttendance!.isUserActive(
        eventId,
        discordUserId,
      );
      if (hasPresence) continue;

      // Also check DB voice sessions for total duration (handles brief join/leave)
      const [voiceSession] = await this.db
        .select({
          totalDurationSec: schema.eventVoiceSessions.totalDurationSec,
        })
        .from(schema.eventVoiceSessions)
        .where(
          and(
            eq(schema.eventVoiceSessions.eventId, eventId),
            eq(schema.eventVoiceSessions.discordUserId, discordUserId),
          ),
        )
        .limit(1);

      if (
        voiceSession &&
        voiceSession.totalDurationSec >= PRESENCE_THRESHOLD_SEC
      ) {
        continue; // Has sufficient voice presence
      }

      absent.push({ ...signup, discordUserId });
    }

    return absent;
  }

  /**
   * Check if a user (by RL userId) has meaningful voice presence for an event.
   */
  private async checkVoicePresence(
    eventId: number,
    userId: number,
  ): Promise<boolean> {
    // Resolve discordUserId from the user record
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user?.discordId) return false;

    // Check in-memory active session
    if (this.voiceAttendance!.isUserActive(eventId, user.discordId)) {
      return true;
    }

    // Check DB for total duration
    const [voiceSession] = await this.db
      .select({ totalDurationSec: schema.eventVoiceSessions.totalDurationSec })
      .from(schema.eventVoiceSessions)
      .where(
        and(
          eq(schema.eventVoiceSessions.eventId, eventId),
          eq(schema.eventVoiceSessions.discordUserId, user.discordId),
        ),
      )
      .limit(1);

    return (
      !!voiceSession && voiceSession.totalDurationSec >= PRESENCE_THRESHOLD_SEC
    );
  }

  /**
   * Get display name and roster role for a player in an event.
   */
  private async getPlayerDisplayInfo(
    eventId: number,
    userId: number,
  ): Promise<{ displayName: string; role: string | null }> {
    // Get user display name
    const [user] = await this.db
      .select({
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const displayName = user?.displayName ?? user?.username ?? 'Unknown';

    // Get roster assignment role
    const [assignment] = await this.db
      .select({ role: schema.rosterAssignments.role })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      )
      .limit(1);

    return { displayName, role: assignment?.role ?? null };
  }

  /**
   * Get user IDs that received Phase 1 (noshow_reminder) for an event.
   */
  private async getPhase1RemindedUserIds(eventId: number): Promise<number[]> {
    const rows = await this.db
      .select({ userId: schema.eventRemindersSent.userId })
      .from(schema.eventRemindersSent)
      .where(
        and(
          eq(schema.eventRemindersSent.eventId, eventId),
          eq(schema.eventRemindersSent.reminderType, 'noshow_reminder'),
        ),
      );

    return rows.map((r) => r.userId);
  }

  /**
   * Resolve the voice channel ID for a game via channel_bindings.
   */
  private async resolveVoiceChannelId(
    gameId: number | null,
  ): Promise<string | null> {
    if (!gameId) return null;

    const [binding] = await this.db
      .select({ channelId: schema.channelBindings.channelId })
      .from(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.gameId, gameId),
          eq(schema.channelBindings.bindingPurpose, 'game-voice-monitor'),
        ),
      )
      .limit(1);

    return binding?.channelId ?? null;
  }

  /**
   * Check if a specific reminder has already been sent.
   */
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

  /**
   * Insert a dedup record into event_reminders_sent.
   * Returns true if inserted (first time), false if already exists (duplicate).
   */
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
