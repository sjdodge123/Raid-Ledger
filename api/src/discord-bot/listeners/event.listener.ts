import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { EmbedPosterService } from '../services/embed-poster.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { GameAffinityNotificationService } from '../../notifications/game-affinity-notification.service';
import { APP_EVENT_EVENTS, EMBED_STATES } from '../discord-bot.constants';
import {
  shouldPostEmbed,
  getLeadTimeFromRecurrence,
} from '../utils/embed-lead-time';
import { EventLifecycleQueueService } from '../queues/event-lifecycle.queue';
import {
  findEventMessages,
  findDiscordMessageRecord,
  updateEmbedRecord,
  enrichEventData,
  cancelEmbedRecord,
  deleteEmbedRecord,
  updateEmbedStateForRecords,
  type EventListenerDeps,
} from './event.listener.handlers';

/** Default lead time for standalone (non-recurring) events: 6 days. */
const STANDALONE_LEAD_TIME_MS = 6 * 24 * 60 * 60 * 1000;

/** Payload emitted with event lifecycle events. */
export interface EventPayload {
  eventId: number;
  event: EmbedEventData;
  gameId?: number | null;
  recurrenceRule?: { frequency: 'weekly' | 'biweekly' | 'monthly' } | null;
  recurrenceGroupId?: string | null;
  creatorId?: number;
  isAdHoc?: boolean;
  notificationChannelOverride?: string | null;
}

/**
 * Listens for application event lifecycle events and manages
 * Discord embed posting, editing, and deletion.
 */
@Injectable()
export class DiscordEventListener {
  private readonly logger = new Logger(DiscordEventListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly embedPoster: EmbedPosterService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
    private readonly scheduledEventService: ScheduledEventService,
    @Optional()
    @Inject(GameAffinityNotificationService)
    private readonly gameAffinityNotificationService: GameAffinityNotificationService | null,
    private readonly eventLifecycleQueue: EventLifecycleQueueService,
  ) {}

  private get deps(): EventListenerDeps {
    return {
      db: this.db,
      clientService: this.clientService,
      embedFactory: this.embedFactory,
      embedPoster: this.embedPoster,
      channelResolver: this.channelResolver,
      logger: this.logger,
    };
  }

  @OnEvent(APP_EVENT_EVENTS.CREATED)
  async handleEventCreated(payload: EventPayload): Promise<void> {
    this.logger.log(
      `handleEventCreated fired for event ${payload.eventId} (isAdHoc=${payload.isAdHoc})`,
    );
    if (payload.isAdHoc) return;
    await this.eventLifecycleQueue.enqueue(payload.eventId, payload);
  }

  @OnEvent(APP_EVENT_EVENTS.UPDATED)
  async handleEventUpdated(payload: EventPayload): Promise<void> {
    this.fireScheduledEventUpdate(payload);
    if (!this.clientService.isConnected()) return;
    const records = await findEventMessages(this.deps, payload.eventId);
    if (records.length === 0) {
      await this.handleMissingEmbedOnUpdate(payload);
      return;
    }
    await this.updateExistingEmbeds(payload, records);
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED)
  async handleEventCancelled(payload: EventPayload): Promise<void> {
    this.fireScheduledEventDelete(payload.eventId);
    if (!this.clientService.isConnected()) return;
    const records = await findEventMessages(this.deps, payload.eventId);
    if (records.length === 0) return;
    const context = await this.buildContext();
    for (const record of records) {
      try {
        await cancelEmbedRecord(
          this.deps,
          record,
          payload.event,
          context,
          payload.eventId,
        );
      } catch (error) {
        this.logger.error(
          `Failed to cancel embed for event ${payload.eventId}:`,
          error,
        );
      }
    }
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED)
  async handleEventDeleted(payload: { eventId: number }): Promise<void> {
    await this.scheduledEventService.deleteScheduledEvent(payload.eventId);
    if (!this.clientService.isConnected()) return;
    const records = await findEventMessages(this.deps, payload.eventId);
    for (const record of records) {
      try {
        await deleteEmbedRecord(this.deps, record, payload.eventId);
      } catch (error) {
        this.logger.error(
          `Failed to delete embed for event ${payload.eventId}:`,
          error,
        );
      }
    }
  }

  /** Update the embed state for an event and re-render the embed. */
  async updateEmbedState(
    eventId: number,
    newState: (typeof EMBED_STATES)[keyof typeof EMBED_STATES],
    event: EmbedEventData,
  ): Promise<void> {
    if (!this.clientService.isConnected()) return;
    const records = await findEventMessages(this.deps, eventId);
    if (records.length === 0) return;
    const context = await this.buildContext();
    await updateEmbedStateForRecords(
      this.deps,
      records,
      event,
      context,
      newState,
      eventId,
    );
  }

  // --- Private helpers ---

  private async buildContext(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return { communityName: branding.communityName, clientUrl, timezone };
  }

  private isWithinLeadTime(payload: EventPayload): boolean {
    const rule = payload.recurrenceRule ?? null;
    const leadTimeMs =
      getLeadTimeFromRecurrence(rule) ?? STANDALONE_LEAD_TIME_MS;
    const timezone = 'UTC';
    if (!shouldPostEmbed(payload.event.startTime, leadTimeMs, timezone)) {
      this.logger.log(
        `Event ${payload.eventId} outside lead-time window, deferring`,
      );
      return false;
    }
    return true;
  }

  private async postEmbed(payload: EventPayload): Promise<boolean> {
    return this.embedPoster.postEmbed(
      payload.eventId,
      payload.event,
      payload.gameId,
      payload.recurrenceGroupId,
      payload.notificationChannelOverride,
    );
  }

  private fireScheduledEventCreate(payload: EventPayload): void {
    this.scheduledEventService
      .createScheduledEvent(
        payload.eventId,
        payload.event,
        payload.gameId,
        payload.isAdHoc,
        payload.notificationChannelOverride,
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to create scheduled event for ${payload.eventId}: ${String(err)}`,
        );
      });
  }

  private async sendGameAffinityNotifications(
    payload: EventPayload,
    posted: boolean,
  ): Promise<void> {
    if (!this.canSendAffinityNotification(payload)) return;
    const discordMessage = posted
      ? await findDiscordMessageRecord(this.deps, payload.eventId)
      : null;
    const context = await this.buildContext();
    this.gameAffinityNotificationService!.notifyGameAffinity({
      eventId: payload.eventId,
      eventTitle: payload.event.title,
      gameName: payload.event.game!.name,
      gameId: payload.gameId!,
      startTime: payload.event.startTime,
      endTime: payload.event.endTime,
      creatorId: payload.creatorId!,
      clientUrl: context.clientUrl,
      gameCoverUrl: payload.event.game!.coverUrl,
      discordMessage,
    }).catch((err: unknown) => {
      this.logger.warn(
        `Failed to send game affinity notifications: ${String(err)}`,
      );
    });
  }

  private canSendAffinityNotification(payload: EventPayload): boolean {
    return !!(
      this.gameAffinityNotificationService &&
      payload.gameId &&
      payload.event.game?.name &&
      payload.creatorId
    );
  }

  private fireScheduledEventUpdate(payload: EventPayload): void {
    this.scheduledEventService
      .updateScheduledEvent(
        payload.eventId,
        payload.event,
        payload.gameId,
        payload.isAdHoc,
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to update scheduled event for ${payload.eventId}: ${String(err)}`,
        );
      });
  }

  private fireScheduledEventDelete(eventId: number): void {
    this.scheduledEventService
      .deleteScheduledEvent(eventId)
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to delete scheduled event for ${eventId}: ${String(err)}`,
        );
      });
  }

  private async handleMissingEmbedOnUpdate(
    payload: EventPayload,
  ): Promise<void> {
    if (this.isWithinLeadTime(payload)) {
      this.logger.log(
        `Rescheduled event ${payload.eventId} is now within lead-time, posting`,
      );
      await this.embedPoster.postEmbed(
        payload.eventId,
        payload.event,
        payload.gameId,
        payload.recurrenceGroupId,
        payload.notificationChannelOverride,
      );
    }
  }

  private async updateExistingEmbeds(
    payload: EventPayload,
    records: (typeof schema.discordEventMessages.$inferSelect)[],
  ): Promise<void> {
    const context = await this.buildContext();
    const eventData = await enrichEventData(this.deps, payload);
    for (const record of records) {
      try {
        const state =
          record.embedState as (typeof EMBED_STATES)[keyof typeof EMBED_STATES];
        await updateEmbedRecord(
          this.deps,
          record,
          eventData,
          context,
          state,
          payload.eventId,
        );
      } catch (error) {
        this.logger.error(
          `Failed to update embed for event ${payload.eventId}:`,
          error,
        );
      }
    }
  }
}
