import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, isNotNull, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  DiscordAPIError,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  UNKNOWN_SCHEDULED_EVENT,
  timedDiscordCall,
  buildDescriptionText,
  type ScheduledEventData,
} from './scheduled-event.helpers';

export type { ScheduledEventData } from './scheduled-event.helpers';

interface ScheduledEventRecord {
  discordScheduledEventId: string | null;
  notificationChannelOverride: string | null;
  recurrenceGroupId: string | null;
}

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

    const candidates = await this.findStartCandidates();
    if (candidates.length === 0) return;

    for (const c of candidates) {
      await this.tryStartEvent(guild, c);
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

      await this.doCreateScheduledEvent(
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

  private async doCreateScheduledEvent(
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

    await this.saveScheduledEventId(eventId, scheduledEvent.id);
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

      await this.doUpdateScheduledEvent(
        guild,
        eventId,
        eventData,
        gameId,
        isAdHoc,
      );
    } catch (error) {
      this.logApiError('update', eventId, error);
    }
  }

  private async doUpdateScheduledEvent(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    eventData: ScheduledEventData,
    gameId?: number | null,
    isAdHoc?: boolean,
  ): Promise<void> {
    const event = await this.getEventWithOverride(eventId);
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

    await this.tryEditScheduledEvent(guild, eventId, event, eventData, gameId);
  }

  /** Delete a Discord Scheduled Event. */
  async deleteScheduledEvent(eventId: number): Promise<void> {
    try {
      if (!this.clientService.isConnected()) return;
      const guild = this.clientService.getGuild();
      if (!guild) return;

      const seId = await this.getScheduledEventId(eventId);
      if (!seId) return;

      await this.tryDeleteEvent(guild, eventId, seId);
      await this.clearScheduledEventId(eventId);
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

      const seId = await this.getScheduledEventId(eventId);
      if (!seId) return;

      await this.tryCompleteEvent(guild, eventId, seId);
      await this.clearScheduledEventId(eventId);
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

      const seId = await this.getScheduledEventId(eventId);
      if (!seId) return;

      await this.tryEditEndTime(guild, eventId, seId, newEndTime);
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

      const seId = await this.getScheduledEventId(eventId);
      if (!seId) return;

      const description = await this.buildDescription(eventId, eventData);
      await this.tryEditDescription(guild, eventId, seId, description);
    } catch (error) {
      this.logApiError('updateDescription', eventId, error);
    }
  }

  // ─── Private helpers ──────────────────────────────────────

  private async findStartCandidates(): Promise<
    Array<{ id: number; discordScheduledEventId: string | null }>
  > {
    const now = new Date();
    return this.db
      .select({
        id: schema.events.id,
        discordScheduledEventId: schema.events.discordScheduledEventId,
      })
      .from(schema.events)
      .where(
        and(
          isNotNull(schema.events.discordScheduledEventId),
          isNull(schema.events.cancelledAt),
          sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
        ),
      );
  }

  private async tryStartEvent(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    candidate: { id: number; discordScheduledEventId: string | null },
  ): Promise<void> {
    try {
      const se = await timedDiscordCall(
        'scheduledEvents.fetch',
        () => guild.scheduledEvents.fetch(candidate.discordScheduledEventId!),
        { eventId: candidate.id },
      );
      if (se.status !== GuildScheduledEventStatus.Scheduled) return;

      await timedDiscordCall(
        'scheduledEvents.edit',
        () =>
          guild.scheduledEvents.edit(candidate.discordScheduledEventId!, {
            status: GuildScheduledEventStatus.Active,
          }),
        { eventId: candidate.id, op: 'start' },
      );
    } catch (error) {
      await this.handleUnknownEventError(error, candidate.id);
    }
  }

  private async resolveEditVoiceChannel(
    event: Pick<
      ScheduledEventRecord,
      'notificationChannelOverride' | 'recurrenceGroupId'
    >,
    gameId?: number | null,
  ): Promise<string | null | undefined> {
    return (
      event.notificationChannelOverride ??
      (await this.channelResolver.resolveVoiceChannelForScheduledEvent(
        gameId,
        event.recurrenceGroupId,
      ))
    );
  }

  private async tryEditScheduledEvent(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    event: ScheduledEventRecord,
    eventData: ScheduledEventData,
    gameId?: number | null,
  ): Promise<void> {
    const description = await this.buildDescription(eventId, eventData);
    const voiceChannelId = await this.resolveEditVoiceChannel(event, gameId);
    try {
      await this.callEditScheduledEvent(
        guild,
        event.discordScheduledEventId!,
        eventId,
        eventData,
        description,
        voiceChannelId,
      );
    } catch (editError) {
      await this.handleEditError(
        editError,
        eventId,
        eventData,
        gameId,
        event.notificationChannelOverride,
      );
    }
  }

  private async callEditScheduledEvent(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    seId: string,
    eventId: number,
    eventData: ScheduledEventData,
    description: string,
    voiceChannelId?: string | null,
  ): Promise<void> {
    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(seId, {
          name: eventData.title,
          scheduledStartTime: new Date(eventData.startTime),
          scheduledEndTime: new Date(eventData.endTime),
          description,
          ...(voiceChannelId ? { channel: voiceChannelId } : {}),
        }),
      { eventId, op: 'update' },
    );
  }

  private async handleEditError(
    error: unknown,
    eventId: number,
    eventData: ScheduledEventData,
    gameId?: number | null,
    channelOverride?: string | null,
  ): Promise<void> {
    if (!this.isUnknownEventError(error)) throw error;
    await this.clearScheduledEventId(eventId);
    await this.createScheduledEvent(
      eventId,
      eventData,
      gameId,
      false,
      channelOverride,
    );
  }

  private async tryCompleteEvent(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    seId: string,
  ): Promise<void> {
    try {
      const se = await timedDiscordCall(
        'scheduledEvents.fetch',
        () => guild.scheduledEvents.fetch(seId),
        { eventId, op: 'complete' },
      );

      if (this.isTerminalStatus(se.status)) return;
      await this.activateAndComplete(guild, eventId, seId, se.status);
    } catch (error) {
      if (!this.isUnknownEventError(error)) throw error;
    }
  }

  private isTerminalStatus(status: GuildScheduledEventStatus): boolean {
    return (
      status === GuildScheduledEventStatus.Completed ||
      status === GuildScheduledEventStatus.Canceled
    );
  }

  private async activateAndComplete(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    seId: string,
    currentStatus: GuildScheduledEventStatus,
  ): Promise<void> {
    if (currentStatus === GuildScheduledEventStatus.Scheduled) {
      await timedDiscordCall(
        'scheduledEvents.edit',
        () =>
          guild.scheduledEvents.edit(seId, {
            status: GuildScheduledEventStatus.Active,
          }),
        { eventId, op: 'complete-activate' },
      );
    }

    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(seId, {
          status: GuildScheduledEventStatus.Completed,
        }),
      { eventId, op: 'complete' },
    );
  }

  private async tryDeleteEvent(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    seId: string,
  ): Promise<void> {
    try {
      await timedDiscordCall(
        'scheduledEvents.delete',
        () => guild.scheduledEvents.delete(seId),
        { eventId },
      );
    } catch (error) {
      if (!this.isUnknownEventError(error)) throw error;
    }
  }

  private async tryEditEndTime(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    seId: string,
    newEndTime: Date,
  ): Promise<void> {
    try {
      await timedDiscordCall(
        'scheduledEvents.edit',
        () =>
          guild.scheduledEvents.edit(seId, {
            scheduledEndTime: newEndTime,
          }),
        { eventId, op: 'updateEndTime' },
      );
    } catch (error) {
      if (this.isUnknownEventError(error)) {
        await this.clearScheduledEventId(eventId);
      } else {
        throw error;
      }
    }
  }

  private async tryEditDescription(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    seId: string,
    description: string,
  ): Promise<void> {
    try {
      await timedDiscordCall(
        'scheduledEvents.edit',
        () => guild.scheduledEvents.edit(seId, { description }),
        { eventId, op: 'updateDescription' },
      );
    } catch (error) {
      if (this.isUnknownEventError(error)) {
        await this.clearScheduledEventId(eventId);
      } else {
        throw error;
      }
    }
  }

  private async resolveVoiceChannel(
    eventId: number,
    gameId?: number | null,
    override?: string | null,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ recurrenceGroupId: schema.events.recurrenceGroupId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    return (
      override ??
      (await this.channelResolver.resolveVoiceChannelForScheduledEvent(
        gameId,
        row?.recurrenceGroupId,
      )) ??
      null
    );
  }

  private async buildDescription(
    eventId: number,
    eventData: ScheduledEventData,
  ): Promise<string> {
    const clientUrl = await this.settingsService.getClientUrl();
    return buildDescriptionText(eventId, eventData, clientUrl);
  }

  private async getScheduledEventId(eventId: number): Promise<string | null> {
    const [event] = await this.db
      .select({
        discordScheduledEventId: schema.events.discordScheduledEventId,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event?.discordScheduledEventId ?? null;
  }

  private async getEventWithOverride(eventId: number): Promise<{
    discordScheduledEventId: string | null;
    notificationChannelOverride: string | null;
    recurrenceGroupId: string | null;
  } | null> {
    const [event] = await this.db
      .select({
        discordScheduledEventId: schema.events.discordScheduledEventId,
        notificationChannelOverride: schema.events.notificationChannelOverride,
        recurrenceGroupId: schema.events.recurrenceGroupId,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event ?? null;
  }

  private async saveScheduledEventId(
    eventId: number,
    seId: string,
  ): Promise<void> {
    await this.db
      .update(schema.events)
      .set({ discordScheduledEventId: seId })
      .where(eq(schema.events.id, eventId));
  }

  private async clearScheduledEventId(eventId: number): Promise<void> {
    await this.db
      .update(schema.events)
      .set({ discordScheduledEventId: null })
      .where(eq(schema.events.id, eventId));
  }

  private async handleUnknownEventError(
    error: unknown,
    eventId: number,
  ): Promise<void> {
    if (this.isUnknownEventError(error)) {
      await this.clearScheduledEventId(eventId);
    } else {
      this.logApiError('start', eventId, error);
    }
  }

  private isUnknownEventError(error: unknown): boolean {
    return (
      error instanceof DiscordAPIError && error.code === UNKNOWN_SCHEDULED_EVENT
    );
  }

  private logApiError(op: string, eventId: number, error: unknown): void {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(
      `Failed to ${op} scheduled event for event ${eventId}: ${msg}`,
    );
  }
}
