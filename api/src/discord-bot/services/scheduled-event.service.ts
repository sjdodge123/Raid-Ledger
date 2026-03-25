import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { ActiveEventCacheService } from '../../events/active-event-cache.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import {
  buildDescriptionText,
  formatApiError,
  getCreateSkipReason,
  type ScheduledEventData,
} from './scheduled-event.helpers';
import {
  findStartCandidates,
  findCompletionCandidates,
  getScheduledEventId,
  getEventWithOverride,
  saveScheduledEventId,
  clearScheduledEventId,
  resolveVoiceForCreate,
  type ScheduledEventRecord,
} from './scheduled-event.db-helpers';
import {
  isUnknownEventError,
  tryStartEvent,
  tryDeleteEvent,
  tryCompleteEvent,
  tryEditEndTime,
  tryEditDescription,
  tryCreateNewEvent,
  tryEditFullEvent,
  resolveVoiceForEdit,
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
    @Optional() private readonly eventCache: ActiveEventCacheService | null,
    @Optional() private readonly embedSyncQueue: EmbedSyncQueueService | null,
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
  async startScheduledEvents(): Promise<void | false> {
    if (!this.clientService.isConnected()) return false;
    const guild = this.clientService.getGuild();
    if (!guild) return false;
    if (
      this.eventCache &&
      this.eventCache.getActiveEvents(new Date()).length === 0
    )
      return false;
    const candidates = await findStartCandidates(this.db);
    if (candidates.length === 0) return false;
    for (const c of candidates) {
      const result = await tryStartEvent(guild, c);
      if (result.cleared) await clearScheduledEventId(this.db, c.id);
      else if (result.error)
        this.logger.error(formatApiError('start', c.id, result.error));
    }
  }

  /** Cron: auto-complete Discord Scheduled Events past end time (ROK-717, ROK-860). */
  @Cron('0 */5 * * * *', {
    name: 'ScheduledEventService_completeScheduledEvents',
  })
  async handleCompleteScheduledEvents(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'ScheduledEventService_completeScheduledEvents',
      () => this.completeExpiredEvents(),
    );
  }

  /** Find and complete events past their effective end time (ROK-717, ROK-944). */
  async completeExpiredEvents(): Promise<void | false> {
    if (!this.clientService.isConnected()) return false;
    const guild = this.clientService.getGuild();
    if (!guild) return false;
    const candidates = await findCompletionCandidates(this.db);
    if (candidates.length === 0) return false;
    for (const c of candidates) {
      await this.completeScheduledEvent(c.id);
      await this.embedSyncQueue
        ?.enqueue(c.id, 'cron-complete')
        .catch((err) =>
          this.logger.warn(
            `Embed-sync enqueue failed for event ${c.id}: ${err instanceof Error ? err.message : 'unknown'}`,
          ),
        );
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
      const skip = getCreateSkipReason(
        eventId,
        eventData.startTime,
        isAdHoc,
        this.clientService.isConnected(),
      );
      if (skip) {
        this.logger.warn(skip);
        return;
      }
      const existing = await getScheduledEventId(this.db, eventId);
      if (existing) {
        this.logger.warn(`Skip SE ${eventId}: already exists`);
        return;
      }
      const guild = this.clientService.getGuild();
      if (!guild) {
        this.logger.warn(`Skip SE ${eventId}: no guild`);
        return;
      }
      await this.doCreate(
        guild,
        eventId,
        eventData,
        gameId,
        voiceChannelOverride,
      );
    } catch (error) {
      this.logger.error(formatApiError('create', eventId, error));
      throw error;
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
      this.logger.error(formatApiError('update', eventId, error));
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
      this.logger.error(formatApiError('delete', eventId, error));
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
      this.logger.error(formatApiError('complete', eventId, error));
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
      this.logger.error(formatApiError('updateEndTime', eventId, error));
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
      this.logger.error(formatApiError('updateDescription', eventId, error));
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
    const vc = await resolveVoiceForCreate(
      this.db,
      eventId,
      gameId,
      voiceChannelOverride,
      this.channelResolver,
    );
    if (!vc) {
      this.logger.warn(`Skip SE ${eventId}: no voice channel`);
      return;
    }
    const desc = await this.buildDescription(eventId, eventData);
    const se = await tryCreateNewEvent(guild, eventId, eventData, vc, desc);
    await saveScheduledEventId(this.db, eventId, se.id);
  }

  private async tryEdit(
    guild: NonNullable<ReturnType<DiscordBotClientService['getGuild']>>,
    eventId: number,
    event: ScheduledEventRecord,
    eventData: ScheduledEventData,
    gameId?: number | null,
  ): Promise<void> {
    const desc = await this.buildDescription(eventId, eventData);
    const vc = await resolveVoiceForEdit(
      guild,
      event,
      gameId,
      this.channelResolver,
    );
    try {
      await tryEditFullEvent(
        guild,
        eventId,
        event.discordScheduledEventId!,
        eventData,
        desc,
        vc,
      );
    } catch (err) {
      if (!isUnknownEventError(err)) throw err;
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

  private async buildDescription(
    eventId: number,
    eventData: ScheduledEventData,
  ): Promise<string> {
    return buildDescriptionText(
      eventId,
      eventData,
      await this.settingsService.getClientUrl(),
    );
  }
}
