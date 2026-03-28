import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ActiveEventCacheService } from '../../events/active-event-cache.service';
import type {
  VoiceSessionsResponseDto,
  VoiceAttendanceSummaryDto,
  AdHocRosterResponseDto,
} from '@raid-ledger/contract';
import {
  type InMemorySession,
  buildActiveRoster,
  yieldToEventLoop,
  rejoinSession,
  createSession,
  leaveSession,
  parseGraceMinutes,
} from './voice-attendance.helpers';
import * as classifyH from './voice-attendance-classify.helpers';
import * as recoveryH from './voice-attendance-recovery.helpers';
import * as flushH from './voice-attendance-flush.helpers';
import * as snapshotH from './voice-attendance-snapshot.helpers';
import { ChannelResolverService } from './channel-resolver.service';

const FLUSH_INTERVAL_MS = 30_000,
  SNAPSHOT_WINDOW_MS = 120_000,
  CLASSIFY_LOOKBACK_MS = 7_200_000;
export { classifyVoiceSession } from './voice-attendance.helpers';

@Injectable()
export class VoiceAttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceAttendanceService.name);
  private sessions = new Map<string, InMemorySession>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private classifyRunning = false;
  /** Track event IDs that have already been snapshotted (ROK-735). */
  private readonly snapshotted = new Set<number>();
  /** Track event IDs that have already been classified (ROK-861). */
  private readonly classified = new Set<number>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly clientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    @Optional() private readonly eventCache: ActiveEventCacheService | null,
  ) {}

  onModuleInit(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      this.flushToDb().catch((e) =>
        this.logger.error(`Periodic flush failed: ${e}`),
      );
    }, FLUSH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.flushToDb().catch((e) =>
      this.logger.error(`Final flush failed: ${e}`),
    );
  }

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
      rejoinSession(existing);
      return;
    }
    createSession(
      this.sessions,
      key,
      eventId,
      discordUserId,
      discordUsername,
      userId,
      discordAvatarHash ?? null,
    );
  }

  handleLeave(eventId: number, discordUserId: string): void {
    const session = this.sessions.get(`${eventId}:${discordUserId}`);
    if (!session) return;
    leaveSession(session);
  }

  async findActiveScheduledEvents(
    channelId: string,
  ): Promise<Array<{ eventId: number; gameId: number | null }>> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.logger.warn(
        '[voice-pipe] findActive: no guildId, channelId=%s',
        channelId,
      );
      return [];
    }
    const bindings = await this.channelBindingsService.getBindings(guildId);
    const defaultVoice =
      await this.settingsService.getDiscordBotDefaultVoiceChannel();
    return flushH.findActiveEventsForChannel(
      this.db,
      channelId,
      bindings,
      flushH.VOICE_BINDING_PURPOSES,
      defaultVoice ?? null,
      this.logger,
    );
  }

  async flushToDb(): Promise<void> {
    await flushH.flushDirtySessions(this.db, this.sessions, this.logger);
  }

  async classifyEvent(
    eventId: number,
    eventData?: typeof schema.events.$inferSelect,
    cachedGraceMs?: number,
  ): Promise<void> {
    const graceMs = cachedGraceMs ?? (await this.getGraceMinutes()) * 60 * 1000;
    await classifyH.classifyEventSessions(
      this.db,
      eventId,
      eventData,
      graceMs,
      this.logger,
    );
  }

  async autoPopulateAttendance(eventId: number): Promise<void> {
    await classifyH.autoPopulateAttendance(this.db, eventId, this.logger);
  }

  async recoverActiveSessions(): Promise<void> {
    const client = this.clientService.getClient();
    const guildId = client ? this.clientService.getGuildId() : null;
    const guild = guildId ? client!.guilds.cache.get(guildId) : undefined;
    if (!guild) return;
    const n = await recoveryH.recoverFromVoiceChannels(
      guild,
      this.db,
      this.sessions,
      (chId) => this.findActiveScheduledEvents(chId),
      (eId, mId, name, avatar) => this.handleJoin(eId, mId, name, null, avatar),
    );
    if (n > 0)
      this.logger.log(`Recovered ${n} voice session(s) from live channels`);
  }

  /** Cron: snapshot voice occupants for recently started events (ROK-735). */
  @Cron('5 */1 * * * *', {
    name: 'VoiceAttendanceService_snapshotOnEventStart',
  })
  async snapshotRecentlyStartedEvents(): Promise<void> {
    if (!this.clientService.isConnected()) return;
    if (
      this.eventCache &&
      this.eventCache.getActiveEvents(new Date()).length === 0
    )
      return;
    await this.cronJobService.executeWithTracking(
      'VoiceAttendanceService_snapshotOnEventStart',
      () =>
        snapshotH.runEventSnapshots(
          this.db,
          new Date(),
          SNAPSHOT_WINDOW_MS,
          this.snapshotted,
          (gId, rId) =>
            this.channelResolver.resolveVoiceChannelForEvent(gId, rId),
          (eId, chId) => this.snapshotVoiceForEvent(eId, chId),
          this.logger,
        ),
    );
  }

  /** Snapshot voice channel members for a single event (ROK-735). */
  snapshotVoiceForEvent(eventId: number, voiceChannelId: string): number {
    const guild = this.clientService.getGuild();
    if (!guild) return 0;
    const channel = snapshotH.resolveVoiceChannelFromGuild(
      guild,
      voiceChannelId,
    );
    if (!channel || channel.members.size === 0) return 0;
    const members = snapshotH.extractVoiceMembers(channel);
    for (const m of members)
      this.handleJoin(
        eventId,
        m.discordUserId,
        m.displayName,
        null,
        m.avatarHash,
      );
    return members.length;
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

  private async runClassification(): Promise<void | false> {
    const now = new Date();
    if (
      this.eventCache?.getRecentlyEndedEvents(now, CLASSIFY_LOOKBACK_MS)
        .length === 0
    )
      return false;
    const all = await flushH.fetchEndedEvents(
      this.db,
      now,
      CLASSIFY_LOOKBACK_MS,
    );
    if (all.length === 0) return false;
    const pending = all.filter((e) => !this.classified.has(e.id));
    const skipped = all.length - pending.length;
    if (skipped > 0)
      this.logger.debug(`Skipped ${skipped} already-classified event(s)`);
    if (pending.length === 0) return;
    const graceMs = (await this.getGraceMinutes()) * 60 * 1000;
    await this.flushToDb();
    for (const ev of pending)
      for (const [, s] of this.sessions)
        if (s.eventId === ev.id && s.isActive)
          this.handleLeave(ev.id, s.discordUserId);
    await this.flushToDb();
    await this.classifyPendingEvents(pending, graceMs);
  }

  private async classifyPendingEvents(
    pending: (typeof schema.events.$inferSelect)[],
    graceMs: number,
  ): Promise<void> {
    for (const event of pending) {
      await yieldToEventLoop();

      if (
        !(await classifyH.shouldClassifyEvent(this.db, event.id, this.logger))
      )
        continue;
      this.logger.log(`Classifying voice attendance for event ${event.id}`);
      await this.classifyEvent(event.id, event, graceMs);
      await this.autoPopulateAttendance(event.id);
      this.classified.add(event.id);
      this.snapshotted.delete(event.id);
      for (const key of this.sessions.keys())
        if (key.startsWith(`${event.id}:`)) this.sessions.delete(key);
    }
  }

  async getVoiceSessions(eventId: number): Promise<VoiceSessionsResponseDto> {
    return flushH.buildVoiceSessionsResponse(this.db, eventId);
  }

  async getVoiceAttendanceSummary(
    eventId: number,
  ): Promise<VoiceAttendanceSummaryDto> {
    return flushH.buildAttendanceSummaryFromDb(this.db, eventId);
  }

  getActiveRoster(eventId: number): AdHocRosterResponseDto {
    return buildActiveRoster(eventId, this.sessions);
  }

  getActiveCount(eventId: number): number {
    return [...this.sessions.values()].filter(
      (s) => s.eventId === eventId && s.isActive,
    ).length;
  }

  isUserActive(eventId: number, discordUserId: string): boolean {
    return this.sessions.get(`${eventId}:${discordUserId}`)?.isActive ?? false;
  }

  private async getGraceMinutes(): Promise<number> {
    return parseGraceMinutes(
      await this.settingsService.get(
        schema.SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES,
      ),
    );
  }
}
