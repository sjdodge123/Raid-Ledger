import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
  yieldToEventLoop,
  rejoinSession,
  createSession,
  leaveSession,
} from './voice-attendance.helpers';
import * as classifyH from './voice-attendance-classify.helpers';
import * as recoveryH from './voice-attendance-recovery.helpers';
import * as flushH from './voice-attendance-flush.helpers';
import * as snapshotH from './voice-attendance-snapshot.helpers';
import { ChannelResolverService } from './channel-resolver.service';

const FLUSH_INTERVAL_MS = 30 * 1000;
/** Window for detecting recently started events (2 minutes). */
const SNAPSHOT_WINDOW_MS = 2 * 60 * 1000;

// Re-export for backward compatibility
export { classifyVoiceSession };

@Injectable()
export class VoiceAttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceAttendanceService.name);
  private sessions = new Map<string, InMemorySession>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private classifyRunning = false;
  /** Track event IDs that have already been snapshotted (ROK-735). */
  private readonly snapshotted = new Set<number>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly clientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
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
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
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
    if (!guildId) return [];
    const now = new Date();
    const bindings = await this.channelBindingsService.getBindings(guildId);
    const voiceBinding = bindings.find(
      (b) =>
        b.channelId === channelId && b.bindingPurpose === 'game-voice-monitor',
    );
    if (voiceBinding && voiceBinding.gameId !== null) {
      return flushH.queryActiveEvents(this.db, voiceBinding.gameId, now);
    }
    const defaultVoice =
      await this.settingsService.getDiscordBotDefaultVoiceChannel();
    if (defaultVoice && channelId === defaultVoice) {
      return flushH.queryActiveEvents(this.db, null, now);
    }
    return [];
  }

  async flushToDb(): Promise<void> {
    const dirtyEntries: InMemorySession[] = [];
    for (const s of this.sessions.values()) {
      if (s.dirty || s.isActive) dirtyEntries.push(s);
    }
    if (dirtyEntries.length === 0) return;
    for (const s of dirtyEntries) {
      await flushH.flushSingleSession(this.db, s, this.logger);
    }
    this.logger.debug(`Flushed ${dirtyEntries.length} voice session(s) to DB`);
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
    if (!client) return;
    const guildId = this.clientService.getGuildId();
    if (!guildId) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const recovered = await recoveryH.recoverFromVoiceChannels(
      guild,
      this.db,
      this.sessions,
      (chId) => this.findActiveScheduledEvents(chId),
      (eId, mId, name, avatar) => this.handleJoin(eId, mId, name, null, avatar),
    );
    if (recovered > 0) {
      this.logger.log(
        `Recovered ${recovered} voice attendance session(s) from live channels`,
      );
    }
  }

  /** Cron: snapshot voice occupants for recently started events (ROK-735). */
  @Cron('5 */1 * * * *', {
    name: 'VoiceAttendanceService_snapshotOnEventStart',
  })
  async snapshotRecentlyStartedEvents(): Promise<void> {
    if (!this.clientService.isConnected()) return;
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
    for (const m of members) {
      this.handleJoin(
        eventId,
        m.discordUserId,
        m.displayName,
        null,
        m.avatarHash,
      );
    }
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

  private async runClassification(): Promise<void> {
    const now = new Date();
    const endedEvents = await flushH.fetchEndedEvents(
      this.db,
      now,
      24 * 60 * 60 * 1000,
    );
    if (endedEvents.length === 0) return;
    const graceMs = (await this.getGraceMinutes()) * 60 * 1000;
    await this.flushToDb();
    for (const event of endedEvents) {
      for (const [, s] of this.sessions) {
        if (s.eventId === event.id && s.isActive)
          this.handleLeave(event.id, s.discordUserId);
      }
    }
    await this.flushToDb();
    for (const event of endedEvents) {
      await this.classifySingleEvent(event, graceMs);
    }
  }

  private async classifySingleEvent(
    event: typeof schema.events.$inferSelect,
    graceMs: number,
  ): Promise<void> {
    await yieldToEventLoop();
    if (!(await classifyH.shouldClassifyEvent(this.db, event.id))) return;
    this.logger.log(`Classifying voice attendance for event ${event.id}`);
    await this.classifyEvent(event.id, event, graceMs);
    await this.autoPopulateAttendance(event.id);
    this.snapshotted.delete(event.id);
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${event.id}:`)) this.sessions.delete(key);
    }
  }

  async getVoiceSessions(eventId: number): Promise<VoiceSessionsResponseDto> {
    const sessions = await flushH.fetchVoiceSessions(this.db, eventId);
    return {
      eventId,
      sessions: sessions.map((s) => toVoiceSessionDto(s)),
    };
  }

  async getVoiceAttendanceSummary(
    eventId: number,
  ): Promise<VoiceAttendanceSummaryDto> {
    const sessions = await flushH.fetchVoiceSessions(this.db, eventId);
    return buildAttendanceSummary(eventId, sessions);
  }

  getActiveRoster(eventId: number): AdHocRosterResponseDto {
    return buildActiveRoster(eventId, this.sessions);
  }

  getActiveCount(eventId: number): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.eventId === eventId && s.isActive) count++;
    }
    return count;
  }

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
}
