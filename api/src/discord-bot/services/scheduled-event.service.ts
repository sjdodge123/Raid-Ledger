import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  timedDiscordCall,
  buildDescriptionText,
  type ScheduledEventData,
} from './scheduled-event.helpers';
import {
  findStartCandidates,
  findCompletionCandidates,
  getScheduledEventId,
  getEventWithOverride,
  saveScheduledEventId,
  clearScheduledEventId,
  getRecurrenceGroupId,
  type ScheduledEventRecord,
} from './scheduled-event.db-helpers';
import {
  isUnknownEventError,
  tryStartEvent,
  tryDeleteEvent,
  tryCompleteEvent,
  tryEditEndTime,
  tryEditDescription,
} from './scheduled-event.discord-ops';

export type { ScheduledEventData } from './scheduled-event.helpers';

/**
 * Manages Discord Scheduled Events for Raid Ledger events (ROK-471).
 */
@Injectable()
export class ScheduledEventService {
  private readonly logger = new Logger(ScheduledEventService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Cron: auto-start Discord Scheduled Events whose start time has passed. */
  @Cron('3,33 * * * * *', {
    name: 'ScheduledEventService_startScheduledEvents',
  })
  async handleStartScheduledEvents(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'ScheduledEventService_startScheduledEvents',
      () => this.startScheduledEvents(),
    );
  }

  /** Find and start scheduled events (ROK-573). */
  async startScheduledEvents(): Promise<void> {
    if (!this.clientService.isConnected()) return;
    const guild = this.clientService.getGuild();
    if (!guild) return;

    const candidates = await findStartCandidates(this.db);
    if (candidates.length === 0) return;

    for (const c of candidates) {
      const result = await tryStartEvent(guild, c);
      if (result.cleared) await clearScheduledEventId(this.db, c.id);
      else if (result.error) this.logApiError('start', c.id, result.error);
    }
  }

  /** Cron: auto-complete Discord Scheduled Events past their end time (ROK-717). */
  @Cron('18,48 * * * * *', {
    name: 'ScheduledEventService_completeScheduledEvents',
  })
  async handleCompleteScheduledEvents(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'ScheduledEventService_completeScheduledEvents',
      () => this.completeExpiredEvents(),
    );
  }

  /** Find and complete events past their effective end time (ROK-717). */
  async completeExpiredEvents(): Promise<void> {
    if (!this.clientService.isConnected()) return;
    const guild = this.clientService.getGuild();
    if (!guild) return;
    const candidates = await findCompletionCandidates(this.db);
    for (const c of candidates) {
      await this.completeScheduledEvent(c.id);
    }
  }

  /** Create a Discord Scheduled Event. */
  async createScheduledEvent(
    eventId: number,
    eventData: ScheduledEventData,
    gameId?: number | null,
    isAdHoc?: boolean,
    voiceChannelOverride?: string | null,
  ): Promise<void> {
    try {
      if (isAdHoc || !this.clientService.isConnected()) return;
      if (new Date(eventData.startTime).getTime() <= Date.now()) return;

      const guild = this.clientService.getGuild();
      if (!guild) return;

      await this.doCreate(
        guild,
        eventId,
        eventData,
        gameId,
        voiceChannelOverride,
      );
    } catch (error) {
      this.logApiError('create', eventId, error);
    }
  }

  /** Update a Discord Scheduled Event. */
  async updateScheduledEvent(
    eventId: number,
    eventData: ScheduledEventData,
    gameId?: number | null,
    isAdHoc?: boolean,
  ): Promise<void> {
    try {
      if (isAdHoc || !this.clientService.isConnected()) return;
      const guild = this.clientService.getGuild();
      if (!guild) return;

      const event = await getEventWithOverride(this.db, eventId);
      if (!event?.discordScheduledEventId) {
        await this.createScheduledEvent(
          eventId,
          eventData,
          gameId,
          isAdHoc,
          event?.notificationChannelOverride,
        );
        return;
      }
      await this.tryEdit(guild, eventId, event, eventData, gameId);
    } catch (error) {
      this.logApiError('update', eventId, error);
    }
  }

  /** Delete a Discord Scheduled Event. */
  async deleteScheduledEvent(eventId: number): Promise<void> {
    try {
      if (!this.clientService.isConnected()) return;
      const guild = this.clientService.getGuild();
      if (!guild) return;

      const seId = await getScheduledEventId(this.db, eventId);
      if (!seId) return;

      await tryDeleteEvent(guild, eventId, seId);
      await clearScheduledEventId(this.db, eventId);
    } catch (error) {
      this.logApiError('delete', eventId, error);
    }
  }

  /** Complete a Discord Scheduled Event (ROK-577). */
  async completeScheduledEvent(eventId: number): Promise<void> {
    try {
      if (!this.clientService.isConnected()) return;
      const guild = this.clientService.getGuild();
      if (!guild) return;

      const seId = await getScheduledEventId(this.db, eventId);
      if (!seId) return;

      await tryCompleteEvent(guild, eventId, seId);
      await clearScheduledEventId(this.db, eventId);
    } catch (error) {
      this.logApiError('complete', eventId, error);
    }
  }

  /** Update only the end time of a scheduled event (ROK-576). */
  async updateEndTime(eventId: number, newEndTime: Date): Promise<void> {
    try {
      if (!this.clientService.isConnected()) return;
      const guild = this.clientService.getGuild();
      if (!guild) return;

      const seId = await getScheduledEventId(this.db, eventId);
      if (!seId) return;

      const cleared = await tryEditEndTime(guild, eventId, seId, newEndTime);
      if (cleared) await clearScheduledEventId(this.db, eventId);
    } catch (error) {
      this.logApiError('updateEndTime', eventId, error);
    }
  }

  /** Update only the description of a scheduled event. */
  async updateDescription(
    eventId: number,
    eventData: ScheduledEventData,
  ): Promise<void> {
    try {
      if (!this.clientService.isConnected()) return;
      const guild = this.clientService.getGuild();
      if (!guild) return;

      const seId = await getScheduledEventId(this.db, eventId);
      if (!seId) return;

      const description = await this.buildDescription(eventId, eventData);
      const cleared = await tryEditDescription(
        guild,
        eventId,
        seId,
        description,
      );
      if (cleared) await clearScheduledEventId(this.db, eventId);
    } catch (error) {
      this.logApiError('updateDescription', eventId, error);
    }
  }

  // ─── Private helpers ──────────────────────────────────────

  private async doCreate(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    eventData: ScheduledEventData,
    gameId?: number | null,
    voiceChannelOverride?: string | null,
  ): Promise<void> {
    const voiceChannelId = await this.resolveVoiceChannel(
      eventId,
      gameId,
      voiceChannelOverride,
    );
    if (!voiceChannelId) return;

    const description = await this.buildDescription(eventId, eventData);
    const scheduledEvent = await timedDiscordCall(
      'scheduledEvents.create',
      () =>
        guild.scheduledEvents.create({
          name: eventData.title,
          scheduledStartTime: new Date(eventData.startTime),
          scheduledEndTime: new Date(eventData.endTime),
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          entityType: GuildScheduledEventEntityType.Voice,
          channel: voiceChannelId,
          description,
        }),
      { eventId },
    );

    await saveScheduledEventId(this.db, eventId, scheduledEvent.id);
  }

  private async tryEdit(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    event: ScheduledEventRecord,
    eventData: ScheduledEventData,
    gameId?: number | null,
  ): Promise<void> {
    const description = await this.buildDescription(eventId, eventData);
    const voiceChannelId = await this.resolveVoiceForEdit(guild, event, gameId);
    try {
      await timedDiscordCall(
        'scheduledEvents.edit',
        () =>
          guild.scheduledEvents.edit(event.discordScheduledEventId!, {
            name: eventData.title,
            scheduledStartTime: new Date(eventData.startTime),
            scheduledEndTime: new Date(eventData.endTime),
            description,
            ...(voiceChannelId ? { channel: voiceChannelId } : {}),
          }),
        { eventId, op: 'update' },
      );
    } catch (editError) {
      if (!isUnknownEventError(editError)) throw editError;
      await clearScheduledEventId(this.db, eventId);
      await this.createScheduledEvent(
        eventId,
        eventData,
        gameId,
        false,
        event.notificationChannelOverride,
      );
    }
  }

  private async resolveVoiceChannel(
    eventId: number,
    gameId?: number | null,
    override?: string | null,
  ): Promise<string | null> {
    const recurrenceGroupId = await getRecurrenceGroupId(this.db, eventId);
    return (
      override ??
      (await this.channelResolver.resolveVoiceChannelForScheduledEvent(
        gameId,
        recurrenceGroupId,
      )) ??
      null
    );
  }

  /**
   * Resolve the voice channel for a scheduled event edit (ROK-716).
   * If notificationChannelOverride is set and is a voice channel, use it.
   * If it's a text channel, fall back to the channel resolver.
   * If it's not in cache, use it optimistically (may be an uncached voice channel).
   */
  private async resolveVoiceForEdit(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    event: ScheduledEventRecord,
    gameId?: number | null,
  ): Promise<string | null> {
    const override = event.notificationChannelOverride;
    if (override) {
      const cached = guild.channels.cache.get(override);
      if (!cached || cached.isVoiceBased()) return override;
    }
    return this.channelResolver.resolveVoiceChannelForScheduledEvent(
      gameId,
      event.recurrenceGroupId,
    );
  }

  private async buildDescription(
    eventId: number,
    eventData: ScheduledEventData,
  ): Promise<string> {
    const clientUrl = await this.settingsService.getClientUrl();
    return buildDescriptionText(eventId, eventData, clientUrl);
  }

  private logApiError(op: string, eventId: number, error: unknown): void {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(
      `Failed to ${op} scheduled event for event ${eventId}: ${msg}`,
    );
  }
}
