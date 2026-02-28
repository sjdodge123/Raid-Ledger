import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq, and } from 'drizzle-orm';
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
import { ScheduledEventService } from '../services/scheduled-event.service';
import { GameAffinityNotificationService } from '../../notifications/game-affinity-notification.service';
import { APP_EVENT_EVENTS, EMBED_STATES } from '../discord-bot.constants';
import {
  shouldPostEmbed,
  getLeadTimeFromRecurrence,
} from '../utils/embed-lead-time';

/** Default lead time for standalone (non-recurring) events: 6 days. */
const STANDALONE_LEAD_TIME_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Payload emitted with event lifecycle events.
 */
export interface EventPayload {
  eventId: number;
  event: EmbedEventData;
  gameId?: number | null;
  /** Recurrence rule from the event, if it's part of a series. */
  recurrenceRule?: {
    frequency: 'weekly' | 'biweekly' | 'monthly';
  } | null;
  recurrenceGroupId?: string | null;
  creatorId?: number;
  /** ROK-293: Ad-hoc events skip Discord Scheduled Event creation */
  isAdHoc?: boolean;
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
    private readonly settingsService: SettingsService,
    private readonly scheduledEventService: ScheduledEventService,
    @Optional()
    @Inject(GameAffinityNotificationService)
    private readonly gameAffinityNotificationService: GameAffinityNotificationService | null,
  ) {}

  @OnEvent(APP_EVENT_EVENTS.CREATED)
  async handleEventCreated(payload: EventPayload): Promise<void> {
    this.logger.log(
      `handleEventCreated fired for event ${payload.eventId} (isAdHoc=${payload.isAdHoc}, connected=${this.clientService.isConnected()})`,
    );

    // ROK-293: Ad-hoc events do NOT trigger Discord Scheduled Event / embed creation
    if (payload.isAdHoc) {
      this.logger.log(`Skipping embed for ad-hoc event ${payload.eventId}`);
      return;
    }

    if (!this.clientService.isConnected()) {
      this.logger.warn('Bot not connected, skipping event.created embed');
      return;
    }

    // ROK-434: Lead-time gating — determine if this event should post now
    const recurrenceRule = payload.recurrenceRule ?? null;
    const leadTimeMs =
      getLeadTimeFromRecurrence(recurrenceRule) ?? STANDALONE_LEAD_TIME_MS;

    const timezone = (await this.settingsService.getDefaultTimezone()) ?? 'UTC';

    if (!shouldPostEmbed(payload.event.startTime, leadTimeMs, timezone)) {
      this.logger.log(
        `Event ${payload.eventId} outside lead-time window (start=${payload.event.startTime}, leadTime=${leadTimeMs}ms, tz=${timezone}), deferring`,
      );
      return;
    }

    // Within the posting window — post immediately via shared service
    const posted = await this.embedPoster.postEmbed(
      payload.eventId,
      payload.event,
      payload.gameId,
      payload.recurrenceGroupId,
    );

    // ROK-471: Create Discord Scheduled Event (fire-and-forget)
    this.scheduledEventService
      .createScheduledEvent(
        payload.eventId,
        payload.event,
        payload.gameId,
        payload.isAdHoc,
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to create scheduled event for event ${payload.eventId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });

    // ROK-440: Notify users with game affinity AFTER embed is successfully posted
    if (
      this.gameAffinityNotificationService &&
      payload.gameId &&
      payload.event.game?.name &&
      payload.creatorId
    ) {
      // ROK-504: Look up Discord message record for "View in Discord" link
      let discordMessage: {
        guildId: string;
        channelId: string;
        messageId: string;
      } | null = null;
      if (posted) {
        const [msgRecord] = await this.db
          .select({
            guildId: schema.discordEventMessages.guildId,
            channelId: schema.discordEventMessages.channelId,
            messageId: schema.discordEventMessages.messageId,
          })
          .from(schema.discordEventMessages)
          .where(eq(schema.discordEventMessages.eventId, payload.eventId))
          .limit(1);
        if (msgRecord) {
          discordMessage = msgRecord;
        }
      }

      const context = await this.buildContext();
      this.gameAffinityNotificationService
        .notifyGameAffinity({
          eventId: payload.eventId,
          eventTitle: payload.event.title,
          gameName: payload.event.game.name,
          gameId: payload.gameId,
          startTime: payload.event.startTime,
          creatorId: payload.creatorId,
          clientUrl: context.clientUrl,
          discordMessage,
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Failed to send game affinity notifications for event ${payload.eventId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        });
    }
  }

  @OnEvent(APP_EVENT_EVENTS.UPDATED)
  async handleEventUpdated(payload: EventPayload): Promise<void> {
    // ROK-471: Update Discord Scheduled Event (fire-and-forget, runs in parallel with embed update)
    this.scheduledEventService
      .updateScheduledEvent(
        payload.eventId,
        payload.event,
        payload.gameId,
        payload.isAdHoc,
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to update scheduled event for event ${payload.eventId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });

    if (!this.clientService.isConnected()) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    // Find all message records for this event
    const records = await this.db
      .select()
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, payload.eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      );

    if (records.length === 0) {
      // ROK-434 Edge Case: Event was rescheduled to be closer and is now
      // within lead time. Post immediately (bypass 1pm gate).
      const recurrenceRule = payload.recurrenceRule ?? null;
      const leadTimeMs =
        getLeadTimeFromRecurrence(recurrenceRule) ?? STANDALONE_LEAD_TIME_MS;
      const timezone =
        (await this.settingsService.getDefaultTimezone()) ?? 'UTC';

      if (shouldPostEmbed(payload.event.startTime, leadTimeMs, timezone)) {
        this.logger.log(
          `Rescheduled event ${payload.eventId} is now within lead-time window, posting embed`,
        );
        await this.embedPoster.postEmbed(
          payload.eventId,
          payload.event,
          payload.gameId,
          payload.recurrenceGroupId,
        );
      } else {
        this.logger.debug(
          `No Discord message found for event ${payload.eventId}, skipping update`,
        );
      }
      return;
    }

    const context = await this.buildContext();

    for (const record of records) {
      try {
        const currentState =
          record.embedState as (typeof EMBED_STATES)[keyof typeof EMBED_STATES];
        const { embed, row } = this.embedFactory.buildEventEmbed(
          payload.event,
          context,
          { state: currentState },
        );

        await this.clientService.editEmbed(
          record.channelId,
          record.messageId,
          embed,
          row,
        );

        await this.db
          .update(schema.discordEventMessages)
          .set({ updatedAt: new Date() })
          .where(eq(schema.discordEventMessages.id, record.id));

        this.logger.log(
          `Updated event embed for event ${payload.eventId} (msg: ${record.messageId})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to update event embed for event ${payload.eventId} (msg: ${record.messageId}):`,
          error,
        );
      }
    }
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED)
  async handleEventCancelled(payload: EventPayload): Promise<void> {
    // ROK-471: Delete Discord Scheduled Event on cancel (fire-and-forget)
    this.scheduledEventService
      .deleteScheduledEvent(payload.eventId)
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to delete scheduled event for cancelled event ${payload.eventId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });

    if (!this.clientService.isConnected()) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    const records = await this.db
      .select()
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, payload.eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      );

    if (records.length === 0) return;

    const context = await this.buildContext();

    for (const record of records) {
      try {
        const { embed } = this.embedFactory.buildEventCancelled(
          payload.event,
          context,
        );

        await this.clientService.editEmbed(
          record.channelId,
          record.messageId,
          embed,
        );

        await this.db
          .update(schema.discordEventMessages)
          .set({
            embedState: EMBED_STATES.CANCELLED,
            updatedAt: new Date(),
          })
          .where(eq(schema.discordEventMessages.id, record.id));

        this.logger.log(
          `Cancelled event embed for event ${payload.eventId} (msg: ${record.messageId})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to cancel event embed for event ${payload.eventId} (msg: ${record.messageId}):`,
          error,
        );
      }
    }
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED)
  async handleEventDeleted(payload: { eventId: number }): Promise<void> {
    // ROK-471: Delete Discord Scheduled Event BEFORE DB delete
    // (event.deleted is emitted before DB row removal — confirmed safe)
    await this.scheduledEventService.deleteScheduledEvent(payload.eventId);

    if (!this.clientService.isConnected()) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    const records = await this.db
      .select()
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, payload.eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      );

    if (records.length === 0) return;

    for (const record of records) {
      try {
        await this.clientService.deleteMessage(
          record.channelId,
          record.messageId,
        );
        this.logger.log(
          `Deleted Discord message for event ${payload.eventId} (msg: ${record.messageId})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to delete Discord message for event ${payload.eventId} (msg: ${record.messageId}):`,
          error,
        );
      }

      await this.db
        .delete(schema.discordEventMessages)
        .where(eq(schema.discordEventMessages.id, record.id));
    }
  }

  /**
   * Update the embed state for an event and re-render the embed.
   * Called by scheduled tasks or state machine triggers.
   */
  async updateEmbedState(
    eventId: number,
    newState: (typeof EMBED_STATES)[keyof typeof EMBED_STATES],
    event: EmbedEventData,
  ): Promise<void> {
    if (!this.clientService.isConnected()) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    const records = await this.db
      .select()
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      );

    if (records.length === 0) return;

    const context = await this.buildContext();

    for (const record of records) {
      try {
        const { embed, row } = this.embedFactory.buildEventEmbed(
          event,
          context,
          { state: newState },
        );

        await this.clientService.editEmbed(
          record.channelId,
          record.messageId,
          embed,
          row,
        );

        await this.db
          .update(schema.discordEventMessages)
          .set({
            embedState: newState,
            updatedAt: new Date(),
          })
          .where(eq(schema.discordEventMessages.id, record.id));

        this.logger.log(
          `Updated embed state for event ${eventId} to ${newState} (msg: ${record.messageId})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to update embed state for event ${eventId} (msg: ${record.messageId}):`,
          error,
        );
      }
    }
  }

  /**
   * Build shared embed context from settings.
   */
  private async buildContext(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return {
      communityName: branding.communityName,
      clientUrl,
      timezone,
    };
  }
}
