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
import type {
  VoiceSessionsResponseDto,
  VoiceAttendanceSummaryDto,
  AdHocRosterResponseDto,
} from '@raid-ledger/contract';
import {
  type InMemorySession,
  classifyVoiceSession,
  toVoiceSessionDto,
  buildAttendanceSummary,
  buildActiveRoster,
  snapshotSessionForFlush,
  yieldToEventLoop,
} from './voice-attendance.helpers';

/** Interval for flushing in-memory sessions to DB (ms). */
const FLUSH_INTERVAL_MS = 30 * 1000;

// Re-export for backward compatibility
export { classifyVoiceSession };

@Injectable()
export class VoiceAttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceAttendanceService.name);
  /** In-memory sessions keyed by `${eventId}:${discordUserId}` */
  private sessions = new Map<string, InMemorySession>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private classifyRunning = false;

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

  /** Handle a user joining the voice channel for a scheduled event. */
  handleJoin(
    eventId: number,
    discordUserId: string,
    discordUsername: string,
    userId: number | null,
    discordAvatarHash?: string | null,
  ): void {
    const key = `${eventId}:${discordUserId}`;
    const existing = this.sessions.get(key);

    if (existing) {
      this.rejoinExistingSession(existing);
      return;
    }

    this.sessions.set(
      key,
      this.createNewSession(
        eventId,
        userId,
        discordUserId,
        discordUsername,
        discordAvatarHash ?? null,
      ),
    );
  }

  private rejoinExistingSession(session: InMemorySession): void {
    if (session.isActive) return;
    const now = new Date();
    session.isActive = true;
    session.activeSegmentStart = now;
    session.segments.push({
      joinAt: now.toISOString(),
      leaveAt: null,
      durationSec: 0,
    });
    session.dirty = true;
  }

  private createNewSession(
    eventId: number,
    userId: number | null,
    discordUserId: string,
    discordUsername: string,
    discordAvatarHash: string | null,
  ): InMemorySession {
    const now = new Date();
    return {
      eventId,
      userId,
      discordUserId,
      discordUsername,
      discordAvatarHash,
      firstJoinAt: now,
      lastLeaveAt: null,
      totalDurationSec: 0,
      segments: [{ joinAt: now.toISOString(), leaveAt: null, durationSec: 0 }],
      isActive: true,
      activeSegmentStart: now,
      dirty: true,
    };
  }

  /** Handle a user leaving the voice channel for a scheduled event. */
  handleLeave(eventId: number, discordUserId: string): void {
    const key = `${eventId}:${discordUserId}`;
    const session = this.sessions.get(key);
    if (!session || !session.isActive) return;

    const now = new Date();
    session.isActive = false;
    session.lastLeaveAt = now;

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

  /** Find active scheduled events for a given voice channel. */
  async findActiveScheduledEvents(
    channelId: string,
  ): Promise<Array<{ eventId: number; gameId: number | null }>> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) return [];

    const now = new Date();
    const bindings = await this.channelBindingsService.getBindings(guildId);
    const voiceBinding = bindings.find(
      (b) =>
        b.channelId === channelId && b.bindingPurpose === 'game-voice-monitor',
    );

    if (voiceBinding && voiceBinding.gameId !== null) {
      return this.queryActiveEvents(voiceBinding.gameId, now);
    }

    const defaultVoice =
      await this.settingsService.getDiscordBotDefaultVoiceChannel();
    if (defaultVoice && channelId === defaultVoice) {
      return this.queryActiveEvents(null, now);
    }
    return [];
  }

  /** Query active scheduled events, optionally filtered by gameId. */
  private async queryActiveEvents(
    gameId: number | null,
    now: Date,
  ): Promise<Array<{ eventId: number; gameId: number | null }>> {
    const conditions = [
      eq(schema.events.isAdHoc, false),
      sql`${schema.events.cancelledAt} IS NULL`,
      sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
      sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
    ];
    if (gameId !== null) {
      conditions.push(eq(schema.events.gameId, gameId));
    }

    const activeEvents = await this.db
      .select({ id: schema.events.id, gameId: schema.events.gameId })
      .from(schema.events)
      .where(and(...conditions));

    return activeEvents.map((e) => ({ eventId: e.id, gameId: e.gameId }));
  }

  /** Flush all dirty in-memory sessions to the database. */
  async flushToDb(): Promise<void> {
    const dirtyEntries: InMemorySession[] = [];
    for (const session of this.sessions.values()) {
      if (session.dirty || session.isActive) dirtyEntries.push(session);
    }
    if (dirtyEntries.length === 0) return;

    for (const session of dirtyEntries) {
      await this.flushSingleSession(session);
    }
    this.logger.debug(`Flushed ${dirtyEntries.length} voice session(s) to DB`);
  }

  /** Flush a single session to the database. */
  private async flushSingleSession(session: InMemorySession): Promise<void> {
    try {
      const snapshot = snapshotSessionForFlush(session);
      await this.upsertSessionRow(session, snapshot);
      session.dirty = false;
    } catch (err) {
      this.logger.error(
        `Failed to flush session ${session.eventId}:${session.discordUserId}: ${err}`,
      );
    }
  }

  private async upsertSessionRow(
    session: InMemorySession,
    snapshot: ReturnType<typeof snapshotSessionForFlush>,
  ): Promise<void> {
    await this.db
      .insert(schema.eventVoiceSessions)
      .values({
        eventId: session.eventId,
        userId: session.userId,
        discordUserId: session.discordUserId,
        discordUsername: session.discordUsername,
        firstJoinAt: session.firstJoinAt,
        lastLeaveAt: session.lastLeaveAt,
        totalDurationSec: snapshot.totalDurationSec,
        segments: snapshot.segments,
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
          totalDurationSec: snapshot.totalDurationSec,
          segments: snapshot.segments,
        },
      });
  }

  /** Classify voice attendance for a completed event. */
  async classifyEvent(
    eventId: number,
    eventData?: typeof schema.events.$inferSelect,
    cachedGraceMs?: number,
  ): Promise<void> {
    const event = eventData ?? (await this.fetchEvent(eventId));
    if (!event) return;

    const eventDurationSec = Math.floor(
      (event.duration[1].getTime() - event.duration[0].getTime()) / 1000,
    );
    if (eventDurationSec <= 0) return;

    const graceMs = cachedGraceMs ?? (await this.getGraceMinutes()) * 60 * 1000;
    await this.classifyEventSessions(eventId, event, eventDurationSec, graceMs);
  }

  private async classifyEventSessions(
    eventId: number,
    event: typeof schema.events.$inferSelect,
    eventDurationSec: number,
    graceMs: number,
  ): Promise<void> {
    const { sessions, orphanCount } = await this.loadAndFilterSessions(eventId);
    if (orphanCount > 0) {
      this.logger.log(
        `Removed ${orphanCount} voice session(s) for non-signed-up users in event ${eventId}`,
      );
    }

    if (sessions.length > 0) {
      await this.batchClassifySessions(
        sessions,
        event.duration[0],
        event.duration[1],
        eventDurationSec,
        graceMs,
      );
    }

    await this.classifyNoShows(eventId, sessions, event);
    this.logger.log(
      `Classified ${sessions.length} voice session(s) for event ${eventId}`,
    );
  }

  /** Load sessions, filter by signups, and delete orphans. */
  private async loadAndFilterSessions(eventId: number): Promise<{
    sessions: Array<typeof schema.eventVoiceSessions.$inferSelect>;
    orphanCount: number;
  }> {
    const allSessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));

    const signedUpIds = await this.getSignedUpDiscordIds(eventId);
    const sessions = allSessions.filter((s) =>
      signedUpIds.has(s.discordUserId),
    );
    const orphanIds = allSessions
      .filter((s) => !signedUpIds.has(s.discordUserId))
      .map((s) => s.id);

    if (orphanIds.length > 0) {
      await this.db
        .delete(schema.eventVoiceSessions)
        .where(
          sql`${schema.eventVoiceSessions.id} IN (${sql.join(orphanIds, sql`, `)})`,
        );
    }

    return { sessions, orphanCount: orphanIds.length };
  }

  private async getSignedUpDiscordIds(eventId: number): Promise<Set<string>> {
    const signups = await this.db
      .select({ discordUserId: schema.eventSignups.discordUserId })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          sql`${schema.eventSignups.discordUserId} IS NOT NULL`,
        ),
      );
    return new Set(
      signups.map((s) => s.discordUserId).filter(Boolean) as string[],
    );
  }

  /** Batch-classify sessions and update DB. */
  private async batchClassifySessions(
    sessions: Array<typeof schema.eventVoiceSessions.$inferSelect>,
    eventStart: Date,
    eventEnd: Date,
    eventDurationSec: number,
    graceMs: number,
  ): Promise<void> {
    const classifications = this.buildClassifications(
      sessions,
      eventStart,
      eventEnd,
      eventDurationSec,
      graceMs,
    );
    const ids = classifications.map((c) => c.id);
    const caseClauses = classifications
      .map(
        (c) =>
          sql`WHEN ${schema.eventVoiceSessions.id} = ${c.id} THEN ${c.classification}`,
      )
      .reduce((acc, clause) => sql`${acc} ${clause}`);

    await this.db
      .update(schema.eventVoiceSessions)
      .set({ classification: sql`CASE ${caseClauses} END` })
      .where(
        sql`${schema.eventVoiceSessions.id} IN (${sql.join(ids, sql`, `)})`,
      );
  }

  private buildClassifications(
    sessions: Array<typeof schema.eventVoiceSessions.$inferSelect>,
    eventStart: Date,
    eventEnd: Date,
    eventDurationSec: number,
    graceMs: number,
  ): Array<{ id: string; classification: string }> {
    return sessions.map((s) => ({
      id: s.id,
      classification: classifyVoiceSession(
        {
          totalDurationSec: s.totalDurationSec,
          firstJoinAt: s.firstJoinAt,
          lastLeaveAt: s.lastLeaveAt,
        },
        eventStart,
        eventEnd,
        eventDurationSec,
        graceMs,
      ),
    }));
  }

  /** Create no_show entries for signed-up users who have no voice session. */
  private async classifyNoShows(
    eventId: number,
    existingSessions: Array<typeof schema.eventVoiceSessions.$inferSelect>,
    eventData?: typeof schema.events.$inferSelect,
  ): Promise<void> {
    const trackedIds = new Set(existingSessions.map((s) => s.discordUserId));
    const signups = await this.fetchActiveSignups(eventId);
    const event = eventData ?? (await this.fetchEvent(eventId));
    if (!event) return;

    const noShowRows = this.buildNoShowRows(
      eventId,
      signups,
      trackedIds,
      event,
    );
    if (noShowRows.length > 0) {
      await this.db
        .insert(schema.eventVoiceSessions)
        .values(noShowRows)
        .onConflictDoNothing();
    }
  }

  private async fetchActiveSignups(eventId: number) {
    return this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          sql`${schema.eventSignups.discordUserId} IS NOT NULL`,
          sql`${schema.eventSignups.status} IN ('signed_up', 'tentative')`,
        ),
      );
  }

  private buildNoShowRows(
    eventId: number,
    signups: Array<typeof schema.eventSignups.$inferSelect>,
    trackedIds: Set<string>,
    event: typeof schema.events.$inferSelect,
  ) {
    return signups
      .filter((s) => s.discordUserId && !trackedIds.has(s.discordUserId))
      .map((s) => ({
        eventId,
        userId: s.userId,
        discordUserId: s.discordUserId!,
        discordUsername: s.discordUsername ?? 'Unknown',
        firstJoinAt: event.duration[0],
        lastLeaveAt: event.duration[0],
        totalDurationSec: 0,
        segments: [] as Array<{
          joinAt: string;
          leaveAt: string | null;
          durationSec: number;
        }>,
        classification: 'no_show',
      }));
  }

  /** Auto-populate event_signups.attendanceStatus from voice classifications. */
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

    if (sessions.length === 0) {
      this.logger.log(
        `Auto-populated attendance for event ${eventId} from 0 voice session(s)`,
      );
      return;
    }

    const now = new Date();
    await this.batchUpdateAttendance(eventId, sessions, now);
    this.logger.log(
      `Auto-populated attendance for event ${eventId} from ${sessions.length} voice session(s)`,
    );
  }

  /** Batch update attendance status for attended and no_show. */
  private async batchUpdateAttendance(
    eventId: number,
    sessions: Array<typeof schema.eventVoiceSessions.$inferSelect>,
    now: Date,
  ): Promise<void> {
    const noShowIds = sessions
      .filter((s) => s.classification === 'no_show')
      .map((s) => s.discordUserId);
    const attendedIds = sessions
      .filter((s) => s.classification !== 'no_show')
      .map((s) => s.discordUserId);

    if (attendedIds.length > 0) {
      await this.setAttendanceStatus(eventId, attendedIds, 'attended', now);
    }
    if (noShowIds.length > 0) {
      await this.setAttendanceStatus(eventId, noShowIds, 'no_show', now);
    }
  }

  private async setAttendanceStatus(
    eventId: number,
    discordUserIds: string[],
    status: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(schema.eventSignups)
      .set({ attendanceStatus: status, attendanceRecordedAt: now })
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          sql`${schema.eventSignups.discordUserId} IN (${sql.join(discordUserIds, sql`, `)})`,
          isNull(schema.eventSignups.attendanceStatus),
        ),
      );
  }

  /** Recover active voice sessions on bot startup. */
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
      if (!channel.isVoiceBased() || channel.members.size === 0) continue;
      const activeEvents = await this.findActiveScheduledEvents(channelId);
      if (activeEvents.length === 0) continue;

      for (const { eventId } of activeEvents) {
        for (const [memberId, guildMember] of channel.members) {
          await this.recoverMemberSession(eventId, memberId, guildMember);
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

  /** Recover a single member's session from DB or create fresh. */
  private async recoverMemberSession(
    eventId: number,
    memberId: string,
    guildMember: import('discord.js').GuildMember,
  ): Promise<void> {
    const displayName =
      guildMember.displayName ?? guildMember.user?.username ?? 'Unknown';
    const avatarHash = guildMember.user?.avatar ?? null;

    const existingDb = await this.fetchDbSession(eventId, memberId);
    if (existingDb) {
      this.restoreExistingSession(
        eventId,
        memberId,
        displayName,
        avatarHash,
        existingDb,
      );
    } else {
      this.handleJoin(eventId, memberId, displayName, null, avatarHash);
    }
  }

  private async fetchDbSession(
    eventId: number,
    memberId: string,
  ): Promise<typeof schema.eventVoiceSessions.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(
        and(
          eq(schema.eventVoiceSessions.eventId, eventId),
          eq(schema.eventVoiceSessions.discordUserId, memberId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private restoreExistingSession(
    eventId: number,
    memberId: string,
    displayName: string,
    avatarHash: string | null,
    existingDb: typeof schema.eventVoiceSessions.$inferSelect,
  ): void {
    const now = new Date();
    const priorSegments = existingDb.segments ?? [];
    this.sessions.set(`${eventId}:${memberId}`, {
      eventId,
      userId: existingDb.userId,
      discordUserId: memberId,
      discordUsername: displayName,
      discordAvatarHash: avatarHash,
      firstJoinAt: existingDb.firstJoinAt,
      lastLeaveAt: null,
      totalDurationSec: existingDb.totalDurationSec ?? 0,
      segments: [
        ...priorSegments.map((s) => ({
          ...s,
          leaveAt: s.leaveAt ?? now.toISOString(),
          durationSec: s.durationSec ?? 0,
        })),
        { joinAt: now.toISOString(), leaveAt: null, durationSec: 0 },
      ],
      isActive: true,
      activeSegmentStart: now,
      dirty: true,
    });
  }

  @Cron('10 */1 * * * *', {
    name: 'VoiceAttendanceService_classifyCompletedEvents',
    waitForCompletion: true,
  })
  async classifyCompletedEvents(): Promise<void> {
    if (this.classifyRunning) {
      this.logger.warn(
        'classifyCompletedEvents: previous run still in progress, skipping',
      );
      return;
    }
    this.classifyRunning = true;
    try {
      await this.cronJobService.executeWithTracking(
        'VoiceAttendanceService_classifyCompletedEvents',
        () => this.runClassification(),
      );
    } finally {
      this.classifyRunning = false;
    }
  }

  /** Core classification loop. */
  private async runClassification(): Promise<void> {
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const endedEvents = await this.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.isAdHoc, false),
          sql`${schema.events.cancelledAt} IS NULL`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${lookbackStart.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) <= ${now.toISOString()}::timestamptz`,
        ),
      );

    if (endedEvents.length === 0) return;

    const graceMs = (await this.getGraceMinutes()) * 60 * 1000;
    await this.flushToDb();

    for (const event of endedEvents) {
      for (const [, session] of this.sessions) {
        if (session.eventId === event.id && session.isActive) {
          this.handleLeave(event.id, session.discordUserId);
        }
      }
    }
    await this.flushToDb();

    for (const event of endedEvents) {
      await this.classifySingleEvent(event, graceMs);
    }
  }

  /** Classify a single ended event (called from cron loop). */
  private async classifySingleEvent(
    event: typeof schema.events.$inferSelect,
    graceMs: number,
  ): Promise<void> {
    await yieldToEventLoop();

    const shouldProcess = await this.shouldClassifyEvent(event.id);
    if (!shouldProcess) return;

    this.logger.log(`Classifying voice attendance for event ${event.id}`);
    await this.classifyEvent(event.id, event, graceMs);
    await this.autoPopulateAttendance(event.id);

    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${event.id}:`)) this.sessions.delete(key);
    }
  }

  /** Check if an event should be classified (has unclassified sessions or needs no-shows). */
  private async shouldClassifyEvent(eventId: number): Promise<boolean> {
    const [unclassified] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.eventVoiceSessions)
      .where(
        and(
          eq(schema.eventVoiceSessions.eventId, eventId),
          isNull(schema.eventVoiceSessions.classification),
        ),
      );

    const [signupCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    const hasUnclassified = unclassified && unclassified.count > 0;
    const hasSignups = signupCount && signupCount.count > 0;
    if (!hasUnclassified && !hasSignups) return false;

    if (!hasUnclassified && hasSignups) {
      const [sessionCount] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.eventVoiceSessions)
        .where(eq(schema.eventVoiceSessions.eventId, eventId));
      if (sessionCount && sessionCount.count > 0) return false;
    }
    return true;
  }

  /** Get raw voice sessions for an event. */
  async getVoiceSessions(eventId: number): Promise<VoiceSessionsResponseDto> {
    const sessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));
    return { eventId, sessions: sessions.map((s) => toVoiceSessionDto(s)) };
  }

  /** Get voice attendance summary with classifications. */
  async getVoiceAttendanceSummary(
    eventId: number,
  ): Promise<VoiceAttendanceSummaryDto> {
    const sessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));
    return buildAttendanceSummary(eventId, sessions);
  }

  /** Get the live roster for a scheduled event from in-memory sessions. */
  getActiveRoster(eventId: number): AdHocRosterResponseDto {
    return buildActiveRoster(eventId, this.sessions);
  }

  /** Get the count of currently active users for a scheduled event. */
  getActiveCount(eventId: number): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.eventId === eventId && session.isActive) count++;
    }
    return count;
  }

  /** Check if a specific user is active in voice for a scheduled event. */
  isUserActive(eventId: number, discordUserId: string): boolean {
    return this.sessions.get(`${eventId}:${discordUserId}`)?.isActive ?? false;
  }

  private async getGraceMinutes(): Promise<number> {
    const value = await this.settingsService.get(
      SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES,
    );
    const parsed = value ? parseInt(value, 10) : NaN;
    return isNaN(parsed) ? 5 : parsed;
  }

  private async fetchEvent(
    eventId: number,
  ): Promise<typeof schema.events.$inferSelect | undefined> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event;
  }
}
