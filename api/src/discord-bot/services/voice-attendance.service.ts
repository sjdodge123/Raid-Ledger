import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SETTING_KEYS } from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  VoiceClassificationEnum,
  type VoiceClassification,
  type EventVoiceSessionDto,
  type VoiceSessionsResponseDto,
  type VoiceAttendanceSummaryDto,
  type AdHocParticipantDto,
  type AdHocRosterResponseDto,
} from '@raid-ledger/contract';

/** Interval for flushing in-memory sessions to DB (ms). */
const FLUSH_INTERVAL_MS = 30 * 1000;

/** In-memory session state for a single user in a single event. */
interface InMemorySession {
  eventId: number;
  userId: number | null;
  discordUserId: string;
  discordUsername: string;
  firstJoinAt: Date;
  lastLeaveAt: Date | null;
  totalDurationSec: number;
  segments: Array<{
    joinAt: string;
    leaveAt: string | null;
    durationSec: number;
  }>;
  /** Whether the user is currently in the voice channel */
  isActive: boolean;
  /** Timestamp of the current active segment start (for duration calculation) */
  activeSegmentStart: Date | null;
  /** Dirty flag — needs DB flush */
  dirty: boolean;
}

@Injectable()
export class VoiceAttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceAttendanceService.name);

  /** In-memory sessions keyed by `${eventId}:${discordUserId}` */
  private sessions = new Map<string, InMemorySession>();

  /** Periodic flush timer */
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly clientService: DiscordBotClientService,
  ) {}

  onModuleInit(): void {
    this.startFlushInterval();
  }

  onModuleDestroy(): void {
    this.stopFlushInterval();
    // Final flush on shutdown
    this.flushToDb().catch((err) =>
      this.logger.error(`Final flush failed: ${err}`),
    );
  }

  private startFlushInterval(): void {
    this.stopFlushInterval();
    this.flushTimer = setInterval(() => {
      this.flushToDb().catch((err) =>
        this.logger.error(`Periodic flush failed: ${err}`),
      );
    }, FLUSH_INTERVAL_MS);
  }

  private stopFlushInterval(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ─── Voice event handlers ──────────────────────────────────

  /**
   * Handle a user joining the voice channel for a scheduled event.
   */
  handleJoin(
    eventId: number,
    discordUserId: string,
    discordUsername: string,
    userId: number | null,
  ): void {
    const key = `${eventId}:${discordUserId}`;
    const now = new Date();

    const existing = this.sessions.get(key);
    if (existing) {
      if (existing.isActive) return; // Already tracked as joined

      // Re-join: start a new segment
      existing.isActive = true;
      existing.activeSegmentStart = now;
      existing.segments.push({
        joinAt: now.toISOString(),
        leaveAt: null,
        durationSec: 0,
      });
      existing.dirty = true;
      return;
    }

    // New session
    this.sessions.set(key, {
      eventId,
      userId,
      discordUserId,
      discordUsername,
      firstJoinAt: now,
      lastLeaveAt: null,
      totalDurationSec: 0,
      segments: [
        {
          joinAt: now.toISOString(),
          leaveAt: null,
          durationSec: 0,
        },
      ],
      isActive: true,
      activeSegmentStart: now,
      dirty: true,
    });
  }

  /**
   * Handle a user leaving the voice channel for a scheduled event.
   */
  handleLeave(eventId: number, discordUserId: string): void {
    const key = `${eventId}:${discordUserId}`;
    const session = this.sessions.get(key);
    if (!session || !session.isActive) return;

    const now = new Date();
    session.isActive = false;
    session.lastLeaveAt = now;

    // Close the current segment
    const lastSegment = session.segments[session.segments.length - 1];
    if (lastSegment && lastSegment.leaveAt === null) {
      lastSegment.leaveAt = now.toISOString();
      const segDuration = session.activeSegmentStart
        ? Math.floor(
            (now.getTime() - session.activeSegmentStart.getTime()) / 1000,
          )
        : 0;
      lastSegment.durationSec = segDuration;
      session.totalDurationSec += segDuration;
    }

    session.activeSegmentStart = null;
    session.dirty = true;
  }

  // ─── Active event resolution ───────────────────────────────

  /**
   * Find active scheduled events for a given voice channel.
   * Resolves: channelId → channel_bindings (game-voice-monitor) → events with matching gameId
   *           that are currently within their scheduled time window.
   *
   * Note: This intentionally does NOT consider `extendedUntil` — voice tracking
   * is scoped to the originally scheduled time window. Users who join during an
   * extension period are not tracked because the extension is a grace period for
   * wrap-up, not an extension of the tracked attendance window.
   */
  async findActiveScheduledEvents(
    channelId: string,
  ): Promise<Array<{ eventId: number; gameId: number | null }>> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) return [];

    const bindings = await this.channelBindingsService.getBindings(guildId);
    const voiceBinding = bindings.find(
      (b) =>
        b.channelId === channelId && b.bindingPurpose === 'game-voice-monitor',
    );

    if (!voiceBinding || voiceBinding.gameId === null) return [];

    const now = new Date();
    const activeEvents = await this.db
      .select({ id: schema.events.id, gameId: schema.events.gameId })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.gameId, voiceBinding.gameId),
          eq(schema.events.isAdHoc, false),
          sql`${schema.events.cancelledAt} IS NULL`,
          // Event is currently active (within its scheduled time window)
          sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
          sql`upper(${schema.events.duration}) >= ${now.toISOString()}::timestamptz`,
        ),
      );

    return activeEvents.map((e) => ({ eventId: e.id, gameId: e.gameId }));
  }

  // ─── DB flush ──────────────────────────────────────────────

  /**
   * Flush all dirty in-memory sessions to the database.
   * Uses upsert with ON CONFLICT (event_id, discord_user_id) DO UPDATE.
   */
  async flushToDb(): Promise<void> {
    const dirtyEntries: InMemorySession[] = [];
    for (const session of this.sessions.values()) {
      // Flush if explicitly dirty OR still actively connected (duration keeps growing)
      if (session.dirty || session.isActive) {
        dirtyEntries.push(session);
      }
    }

    if (dirtyEntries.length === 0) return;

    for (const session of dirtyEntries) {
      try {
        // Snapshot current active segment duration for the flush
        const snapshotSegments = [...session.segments];
        let snapshotTotal = session.totalDurationSec;
        if (session.isActive && session.activeSegmentStart) {
          const activeDur = Math.floor(
            (Date.now() - session.activeSegmentStart.getTime()) / 1000,
          );
          // Update the last segment's durationSec in snapshot
          const last = snapshotSegments[snapshotSegments.length - 1];
          if (last && last.leaveAt === null) {
            snapshotSegments[snapshotSegments.length - 1] = {
              ...last,
              durationSec: activeDur,
            };
            snapshotTotal += activeDur;
          }
        }

        await this.db
          .insert(schema.eventVoiceSessions)
          .values({
            eventId: session.eventId,
            userId: session.userId,
            discordUserId: session.discordUserId,
            discordUsername: session.discordUsername,
            firstJoinAt: session.firstJoinAt,
            lastLeaveAt: session.lastLeaveAt,
            totalDurationSec: snapshotTotal,
            segments: snapshotSegments,
          })
          .onConflictDoUpdate({
            target: [
              schema.eventVoiceSessions.eventId,
              schema.eventVoiceSessions.discordUserId,
            ],
            set: {
              userId: session.userId,
              discordUsername: session.discordUsername,
              lastLeaveAt: session.lastLeaveAt,
              totalDurationSec: snapshotTotal,
              segments: snapshotSegments,
            },
          });

        session.dirty = false;
      } catch (err) {
        this.logger.error(
          `Failed to flush session ${session.eventId}:${session.discordUserId}: ${err}`,
        );
      }
    }

    this.logger.debug(`Flushed ${dirtyEntries.length} voice session(s) to DB`);
  }

  // ─── Classification ────────────────────────────────────────

  /**
   * Classify voice attendance for a completed event.
   * Called by cron job after an event's end time has passed.
   */
  async classifyEvent(eventId: number): Promise<void> {
    // Load the event
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) return;

    const eventStart = event.duration[0];
    const eventEnd = event.duration[1];
    const eventDurationSec = Math.floor(
      (eventEnd.getTime() - eventStart.getTime()) / 1000,
    );

    if (eventDurationSec <= 0) return;

    // Get the grace period setting
    const graceMinutes = await this.getGraceMinutes();
    const graceMs = graceMinutes * 60 * 1000;

    // Load all voice sessions for this event
    const sessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));

    // Classify each session
    for (const session of sessions) {
      const classification = this.classifySession(
        session,
        eventStart,
        eventEnd,
        eventDurationSec,
        graceMs,
      );

      await this.db
        .update(schema.eventVoiceSessions)
        .set({ classification })
        .where(eq(schema.eventVoiceSessions.id, session.id));
    }

    // Also classify users who signed up but never joined (no_show)
    await this.classifyNoShows(eventId, sessions);

    this.logger.log(
      `Classified ${sessions.length} voice session(s) for event ${eventId}`,
    );
  }

  /**
   * Classify a single voice session — delegates to the exported pure function.
   */
  private classifySession(
    session: typeof schema.eventVoiceSessions.$inferSelect,
    eventStart: Date,
    eventEnd: Date,
    eventDurationSec: number,
    graceMs: number,
  ): VoiceClassification {
    return classifyVoiceSession(
      {
        totalDurationSec: session.totalDurationSec,
        firstJoinAt: session.firstJoinAt,
        lastLeaveAt: session.lastLeaveAt,
      },
      eventStart,
      eventEnd,
      eventDurationSec,
      graceMs,
    );
  }

  /**
   * Create no_show entries for signed-up users who have no voice session.
   */
  private async classifyNoShows(
    eventId: number,
    existingSessions: Array<typeof schema.eventVoiceSessions.$inferSelect>,
  ): Promise<void> {
    const trackedDiscordIds = new Set(
      existingSessions.map((s) => s.discordUserId),
    );

    // Find all signups with a discordUserId
    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          sql`${schema.eventSignups.discordUserId} IS NOT NULL`,
          sql`${schema.eventSignups.status} IN ('signed_up', 'tentative')`,
        ),
      );

    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) return;

    for (const signup of signups) {
      if (
        !signup.discordUserId ||
        trackedDiscordIds.has(signup.discordUserId)
      ) {
        continue;
      }

      // Create a no_show voice session
      await this.db
        .insert(schema.eventVoiceSessions)
        .values({
          eventId,
          userId: signup.userId,
          discordUserId: signup.discordUserId,
          discordUsername: signup.discordUsername ?? 'Unknown',
          firstJoinAt: event.duration[0],
          lastLeaveAt: event.duration[0],
          totalDurationSec: 0,
          segments: [],
          classification: 'no_show',
        })
        .onConflictDoNothing();
    }
  }

  /**
   * Auto-populate event_signups.attendanceStatus from voice classifications.
   * Only updates signups where attendanceStatus is NULL (preserves manual overrides).
   */
  async autoPopulateAttendance(eventId: number): Promise<void> {
    const sessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(
        and(
          eq(schema.eventVoiceSessions.eventId, eventId),
          sql`${schema.eventVoiceSessions.classification} IS NOT NULL`,
        ),
      );

    for (const session of sessions) {
      const attendanceStatus =
        session.classification === 'no_show' ? 'no_show' : 'attended';

      // Only update signups where attendanceStatus is NULL
      await this.db
        .update(schema.eventSignups)
        .set({
          attendanceStatus,
          attendanceRecordedAt: new Date(),
        })
        .where(
          and(
            eq(schema.eventSignups.eventId, eventId),
            eq(schema.eventSignups.discordUserId, session.discordUserId),
            isNull(schema.eventSignups.attendanceStatus),
          ),
        );
    }

    this.logger.log(
      `Auto-populated attendance for event ${eventId} from ${sessions.length} voice session(s)`,
    );
  }

  // ─── Recovery ──────────────────────────────────────────────

  /**
   * Recover active voice sessions on bot startup.
   * Called from VoiceStateListener after bot connects.
   * Scans voice channels for users currently in channels with active scheduled events.
   */
  async recoverActiveSessions(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const voiceChannels = guild.channels.cache.filter((ch) =>
      ch.isVoiceBased(),
    );

    let recovered = 0;

    for (const [channelId, channel] of voiceChannels) {
      if (!channel.isVoiceBased()) continue;
      if (channel.members.size === 0) continue;

      const activeEvents = await this.findActiveScheduledEvents(channelId);
      if (activeEvents.length === 0) continue;

      for (const { eventId } of activeEvents) {
        for (const [memberId, guildMember] of channel.members) {
          const key = `${eventId}:${memberId}`;
          // Load existing DB session so accumulated time is preserved across restarts
          const [existingDb] = await this.db
            .select()
            .from(schema.eventVoiceSessions)
            .where(
              and(
                eq(schema.eventVoiceSessions.eventId, eventId),
                eq(schema.eventVoiceSessions.discordUserId, memberId),
              ),
            )
            .limit(1);

          const now = new Date();
          if (existingDb) {
            // Restore from DB and resume tracking
            const priorSegments = existingDb.segments ?? [];
            this.sessions.set(key, {
              eventId,
              userId: existingDb.userId,
              discordUserId: memberId,
              discordUsername:
                guildMember.displayName ??
                guildMember.user?.username ??
                'Unknown',
              firstJoinAt: existingDb.firstJoinAt,
              lastLeaveAt: null,
              totalDurationSec: existingDb.totalDurationSec ?? 0,
              segments: [
                ...priorSegments.map((s) => ({
                  ...s,
                  // Close any open segments from before the restart
                  leaveAt: s.leaveAt ?? now.toISOString(),
                  durationSec: s.durationSec ?? 0,
                })),
                {
                  joinAt: now.toISOString(),
                  leaveAt: null,
                  durationSec: 0,
                },
              ],
              isActive: true,
              activeSegmentStart: now,
              dirty: true,
            });
          } else {
            this.handleJoin(
              eventId,
              memberId,
              guildMember.displayName ??
                guildMember.user?.username ??
                'Unknown',
              null,
            );
          }
          recovered++;
        }
      }
    }

    if (recovered > 0) {
      this.logger.log(
        `Recovered ${recovered} voice attendance session(s) from live channels`,
      );
    }
  }

  // ─── Cron: classify completed events ───────────────────────

  @Cron('10 */1 * * * *', {
    name: 'VoiceAttendanceService_classifyCompletedEvents',
    waitForCompletion: true,
  })
  async classifyCompletedEvents(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'VoiceAttendanceService_classifyCompletedEvents',
      async () => {
        // Look back 24 hours for events that ended but haven't been classified.
        // A wide window ensures events are still classified after API downtime
        // (e.g. restart, outage). The "already classified" guard below prevents
        // re-processing events that were handled in a prior run.
        const now = new Date();
        const lookbackStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const endedEvents = await this.db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(
            and(
              eq(schema.events.isAdHoc, false),
              sql`${schema.events.cancelledAt} IS NULL`,
              // Event ended between lookback window start and now
              sql`upper(${schema.events.duration}) >= ${lookbackStart.toISOString()}::timestamptz`,
              sql`upper(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
            ),
          );

        if (endedEvents.length === 0) return;

        // Flush any remaining in-memory sessions first
        await this.flushToDb();

        // Close any still-active in-memory sessions for these events
        for (const event of endedEvents) {
          for (const [, session] of this.sessions) {
            if (session.eventId === event.id && session.isActive) {
              this.handleLeave(event.id, session.discordUserId);
            }
          }
        }

        // Flush the closed sessions
        await this.flushToDb();

        for (const event of endedEvents) {
          // Check if already fully classified (all sessions have a classification)
          const [unclassified] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.eventVoiceSessions)
            .where(
              and(
                eq(schema.eventVoiceSessions.eventId, event.id),
                isNull(schema.eventVoiceSessions.classification),
              ),
            );

          // Check if there are signups that might need no_show classification
          const [signupCount] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.eventSignups)
            .where(eq(schema.eventSignups.eventId, event.id));

          const hasUnclassifiedSessions =
            unclassified && unclassified.count > 0;
          const hasSignups = signupCount && signupCount.count > 0;

          // Skip if no unclassified sessions AND no signups to check for no-shows
          if (!hasUnclassifiedSessions && !hasSignups) continue;

          // Skip if already processed (sessions exist, all classified, and no-shows already created)
          if (!hasUnclassifiedSessions && hasSignups) {
            const [sessionCount] = await this.db
              .select({ count: sql<number>`count(*)::int` })
              .from(schema.eventVoiceSessions)
              .where(eq(schema.eventVoiceSessions.eventId, event.id));
            // If we already have sessions (including no_show records), skip
            if (sessionCount && sessionCount.count > 0) continue;
          }

          this.logger.log(`Classifying voice attendance for event ${event.id}`);
          await this.classifyEvent(event.id);
          await this.autoPopulateAttendance(event.id);

          // Clean up in-memory sessions for this event
          for (const key of this.sessions.keys()) {
            if (key.startsWith(`${event.id}:`)) {
              this.sessions.delete(key);
            }
          }
        }
      },
    );
  }

  // ─── API methods ───────────────────────────────────────────
  // TODO(ROK-589): If voice attendance grows (manual trigger, re-classify
  // endpoint), consider a thin VoiceAttendanceController inside DiscordBotModule
  // rather than further inflating EventsController.

  /**
   * Get raw voice sessions for an event.
   */
  async getVoiceSessions(eventId: number): Promise<VoiceSessionsResponseDto> {
    const sessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));

    return {
      eventId,
      sessions: sessions.map((s) => this.toDto(s)),
    };
  }

  /**
   * Get voice attendance summary with classifications.
   */
  async getVoiceAttendanceSummary(
    eventId: number,
  ): Promise<VoiceAttendanceSummaryDto> {
    const sessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));

    const dtos = sessions.map((s) => this.toDto(s));

    return {
      eventId,
      totalTracked: sessions.length,
      full: sessions.filter((s) => s.classification === 'full').length,
      partial: sessions.filter((s) => s.classification === 'partial').length,
      late: sessions.filter((s) => s.classification === 'late').length,
      earlyLeaver: sessions.filter((s) => s.classification === 'early_leaver')
        .length,
      noShow: sessions.filter((s) => s.classification === 'no_show').length,
      unclassified: sessions.filter((s) => s.classification === null).length,
      sessions: dtos,
    };
  }

  /**
   * Get the live roster for a scheduled event from in-memory sessions.
   * Maps InMemorySession fields to AdHocParticipantDto shape for reuse.
   */
  getActiveRoster(eventId: number): AdHocRosterResponseDto {
    const participants: AdHocParticipantDto[] = [];

    for (const session of this.sessions.values()) {
      if (session.eventId !== eventId) continue;

      const now = new Date();
      let totalDuration = session.totalDurationSec;
      if (session.isActive && session.activeSegmentStart) {
        totalDuration += Math.floor(
          (now.getTime() - session.activeSegmentStart.getTime()) / 1000,
        );
      }

      participants.push({
        id: session.discordUserId,
        eventId: session.eventId,
        userId: session.userId,
        discordUserId: session.discordUserId,
        discordUsername: session.discordUsername,
        discordAvatarHash: null,
        joinedAt: session.firstJoinAt.toISOString(),
        leftAt: session.isActive
          ? null
          : (session.lastLeaveAt?.toISOString() ?? null),
        totalDurationSeconds: totalDuration,
        sessionCount: session.segments.length,
      });
    }

    const activeCount = participants.filter((p) => p.leftAt === null).length;
    return { eventId, participants, activeCount };
  }

  /**
   * Get the count of currently active users for a scheduled event.
   */
  getActiveCount(eventId: number): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.eventId === eventId && session.isActive) {
        count++;
      }
    }
    return count;
  }

  // ─── Private helpers ───────────────────────────────────────

  private async getGraceMinutes(): Promise<number> {
    const value = await this.settingsService.get(
      SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES,
    );
    const parsed = value ? parseInt(value, 10) : NaN;
    return isNaN(parsed) ? 5 : parsed;
  }

  private toDto(
    session: typeof schema.eventVoiceSessions.$inferSelect,
  ): EventVoiceSessionDto {
    return {
      id: session.id,
      eventId: session.eventId,
      userId: session.userId,
      discordUserId: session.discordUserId,
      discordUsername: session.discordUsername,
      firstJoinAt: session.firstJoinAt.toISOString(),
      lastLeaveAt: session.lastLeaveAt?.toISOString() ?? null,
      totalDurationSec: session.totalDurationSec,
      segments: (session.segments ?? []) as Array<{
        joinAt: string;
        leaveAt: string | null;
        durationSec: number;
      }>,
      classification: session.classification
        ? (VoiceClassificationEnum.safeParse(session.classification).data ??
          null)
        : null,
    };
  }
}

// ─── Exported pure function for testability ────────────────

/**
 * Classify a voice session based on event timing and presence.
 * Exported for unit testing.
 *
 * Priority: no_show > late > early_leaver > partial > full
 *
 * Design rationale for priority ordering:
 * - `late` takes priority over `full` because punctuality is a distinct
 *   trackable behavior. A user who joins 6 minutes late to a 3-hour raid
 *   gets `late` even with 95% presence — this ensures officers can see
 *   who was on time vs. who wasn't, regardless of total duration.
 * - `early_leaver` is separate from `partial` to distinguish users who
 *   explicitly left before the event ended from those with intermittent
 *   connectivity or partial attendance throughout.
 */
export function classifyVoiceSession(
  session: {
    totalDurationSec: number;
    firstJoinAt: Date;
    lastLeaveAt: Date | null;
  },
  eventStart: Date,
  eventEnd: Date,
  eventDurationSec: number,
  graceMs: number,
): VoiceClassification {
  const totalSec = session.totalDurationSec;
  const presenceRatio = totalSec / eventDurationSec;

  // 1. no_show: never joined meaningfully (< 2 minutes)
  if (totalSec < 120) {
    return 'no_show';
  }

  const firstJoin = session.firstJoinAt;
  const lastLeave = session.lastLeaveAt;
  const joinedLate = firstJoin.getTime() > eventStart.getTime() + graceMs;
  const leftEarly = lastLeave
    ? lastLeave.getTime() < eventEnd.getTime() - 5 * 60 * 1000
    : false;

  // 2. late: joined after grace window, but had meaningful presence (>= 20%)
  if (joinedLate && presenceRatio >= 0.2) {
    return 'late';
  }

  // 3. early_leaver: left before event end - 5min, presence 20-79%
  if (leftEarly && presenceRatio >= 0.2 && presenceRatio < 0.8) {
    return 'early_leaver';
  }

  // 4. partial: presence 20-79%, on time, didn't leave early
  if (presenceRatio >= 0.2 && presenceRatio < 0.8) {
    return 'partial';
  }

  // 5. full: presence >= 80%
  if (presenceRatio >= 0.8) {
    return 'full';
  }

  // Fallback for edge cases
  return 'partial';
}
