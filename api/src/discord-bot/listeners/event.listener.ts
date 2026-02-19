import { Injectable, Inject, Logger } from '@nestjs/common';
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
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { APP_EVENT_EVENTS, EMBED_STATES } from '../discord-bot.constants';

/**
 * Payload emitted with event lifecycle events.
 */
export interface EventPayload {
  eventId: number;
  event: EmbedEventData;
  gameId?: number | null;
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
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
  ) {}

  @OnEvent(APP_EVENT_EVENTS.CREATED)
  async handleEventCreated(payload: EventPayload): Promise<void> {
    if (!this.clientService.isConnected()) {
      this.logger.debug('Bot not connected, skipping event.created embed');
      return;
    }

    const channelId = await this.channelResolver.resolveChannelForEvent(
      payload.gameId,
    );
    if (!channelId) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.logger.warn('Bot is not in any guild, skipping event.created embed');
      return;
    }

    try {
      const context = await this.buildContext();
      const { embed, row } = this.embedFactory.buildEventAnnouncement(
        payload.event,
        context,
      );

      const message = await this.clientService.sendEmbed(channelId, embed, row);

      // Store message reference
      await this.db.insert(schema.discordEventMessages).values({
        eventId: payload.eventId,
        guildId,
        channelId,
        messageId: message.id,
        embedState: EMBED_STATES.POSTED,
      });

      this.logger.log(
        `Posted event embed for event ${payload.eventId} to channel ${channelId} (msg: ${message.id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to post event embed for event ${payload.eventId}:`,
        error,
      );
    }
  }

  @OnEvent(APP_EVENT_EVENTS.UPDATED)
  async handleEventUpdated(payload: EventPayload): Promise<void> {
    if (!this.clientService.isConnected()) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    // Find existing message record
    const records = await this.db
      .select()
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, payload.eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      )
      .limit(1);

    if (records.length === 0) {
      this.logger.debug(
        `No Discord message found for event ${payload.eventId}, skipping update`,
      );
      return;
    }

    const record = records[0];

    try {
      const context = await this.buildContext();
      const currentState =
        record.embedState as (typeof EMBED_STATES)[keyof typeof EMBED_STATES];
      const { embed, row } = this.embedFactory.buildEventUpdate(
        payload.event,
        context,
        currentState,
      );

      await this.clientService.editEmbed(
        record.channelId,
        record.messageId,
        embed,
        row,
      );

      // Update timestamp
      await this.db
        .update(schema.discordEventMessages)
        .set({ updatedAt: new Date() })
        .where(eq(schema.discordEventMessages.id, record.id));

      this.logger.log(
        `Updated event embed for event ${payload.eventId} (msg: ${record.messageId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update event embed for event ${payload.eventId}:`,
        error,
      );
    }
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED)
  async handleEventCancelled(payload: EventPayload): Promise<void> {
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
      )
      .limit(1);

    if (records.length === 0) return;

    const record = records[0];

    try {
      const context = await this.buildContext();
      const { embed } = this.embedFactory.buildEventCancelled(
        payload.event,
        context,
      );

      // Edit to cancelled state with no buttons
      await this.clientService.editEmbed(
        record.channelId,
        record.messageId,
        embed,
      );

      // Update state to cancelled
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
        `Failed to cancel event embed for event ${payload.eventId}:`,
        error,
      );
    }
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED)
  async handleEventDeleted(payload: { eventId: number }): Promise<void> {
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
      )
      .limit(1);

    if (records.length === 0) return;

    const record = records[0];

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
        `Failed to delete Discord message for event ${payload.eventId}:`,
        error,
      );
    }

    // The DB record will be cleaned up by CASCADE on events deletion,
    // but if we need explicit cleanup:
    await this.db
      .delete(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.id, record.id));
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
      )
      .limit(1);

    if (records.length === 0) return;

    const record = records[0];

    try {
      const context = await this.buildContext();
      const { embed, row } = this.embedFactory.buildEventUpdate(
        event,
        context,
        newState,
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
        `Updated embed state for event ${eventId} to ${newState}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update embed state for event ${eventId}:`,
        error,
      );
    }
  }

  /**
   * Build shared embed context from settings.
   */
  private async buildContext(): Promise<EmbedContext> {
    const branding = await this.settingsService.getBranding();
    return {
      communityName: branding.communityName,
      clientUrl: process.env.CLIENT_URL ?? null,
    };
  }
}
