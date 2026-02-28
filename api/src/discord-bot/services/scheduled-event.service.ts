import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  DiscordAPIError,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';

/** Discord API error code for "Unknown Scheduled Event" (manually deleted). */
const UNKNOWN_SCHEDULED_EVENT = 10070;

/** Maximum description length for Discord Scheduled Events. */
const MAX_DESCRIPTION_LENGTH = 1000;

export interface ScheduledEventData {
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  signupCount: number;
  maxAttendees?: number | null;
  game?: { name: string } | null;
}

/**
 * Manages Discord Scheduled Events for Raid Ledger events (ROK-471).
 *
 * Creates VOICE-type scheduled events tied to voice channels for server
 * calendar visibility and LIVE server badge. Does NOT handle reminders
 * or signups — those are handled by Raid Ledger DMs.
 *
 * All methods are fire-and-forget safe: errors are caught and logged,
 * never propagated to the caller.
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
  ) {}

  /**
   * Create a Discord Scheduled Event for a Raid Ledger event.
   * Skips if: ad-hoc, no voice channel, start time in past, bot disconnected.
   */
  async createScheduledEvent(
    eventId: number,
    eventData: ScheduledEventData,
    gameId?: number | null,
    isAdHoc?: boolean,
  ): Promise<void> {
    try {
      if (isAdHoc) {
        this.logger.debug(
          `Skipping scheduled event for ad-hoc event ${eventId}`,
        );
        return;
      }

      if (!this.clientService.isConnected()) {
        this.logger.warn(
          `Bot not connected, skipping scheduled event for event ${eventId}`,
        );
        return;
      }

      const startTime = new Date(eventData.startTime);
      if (startTime.getTime() <= Date.now()) {
        this.logger.debug(
          `Start time in past (${eventData.startTime}), skipping scheduled event for event ${eventId}`,
        );
        return;
      }

      const guild = this.clientService.getGuild();
      if (!guild) {
        this.logger.warn(
          `No guild available, skipping scheduled event for event ${eventId}`,
        );
        return;
      }

      const voiceChannelId =
        await this.channelResolver.resolveVoiceChannelForScheduledEvent(gameId);
      if (!voiceChannelId) {
        this.logger.warn(
          `No voice channel resolved for event ${eventId}, skipping scheduled event`,
        );
        return;
      }

      const description = await this.buildDescription(eventId, eventData);

      this.logger.debug(
        `Creating scheduled event for event ${eventId}: channel=${voiceChannelId}, start=${eventData.startTime}, end=${eventData.endTime}`,
      );

      const scheduledEvent = await guild.scheduledEvents.create({
        name: eventData.title,
        scheduledStartTime: startTime,
        scheduledEndTime: new Date(eventData.endTime),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: voiceChannelId,
        description,
      });

      await this.db
        .update(schema.events)
        .set({ discordScheduledEventId: scheduledEvent.id })
        .where(eq(schema.events.id, eventId));

      this.logger.log(
        `Created Discord Scheduled Event ${scheduledEvent.id} for event ${eventId}`,
      );
    } catch (error) {
      const details =
        error instanceof DiscordAPIError
          ? `code=${error.code}, status=${error.status}, method=${error.method}, url=${error.url}`
          : '';
      this.logger.error(
        `Failed to create scheduled event for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}${details ? ` [${details}]` : ''}`,
      );
    }
  }

  /**
   * Update a Discord Scheduled Event (title, description, time).
   * If the event was manually deleted in Discord, recreates it.
   */
  async updateScheduledEvent(
    eventId: number,
    eventData: ScheduledEventData,
    gameId?: number | null,
    isAdHoc?: boolean,
  ): Promise<void> {
    try {
      if (isAdHoc) {
        this.logger.debug(
          `Skipping scheduled event update for ad-hoc event ${eventId}`,
        );
        return;
      }

      if (!this.clientService.isConnected()) {
        this.logger.debug(
          `Bot not connected, skipping scheduled event update for event ${eventId}`,
        );
        return;
      }

      const guild = this.clientService.getGuild();
      if (!guild) {
        this.logger.debug(
          `No guild available, skipping scheduled event update for event ${eventId}`,
        );
        return;
      }

      // Get stored scheduled event ID
      const [event] = await this.db
        .select({
          discordScheduledEventId: schema.events.discordScheduledEventId,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event?.discordScheduledEventId) {
        // No scheduled event yet — create one
        this.logger.debug(
          `No existing scheduled event for event ${eventId}, creating new one`,
        );
        await this.createScheduledEvent(eventId, eventData, gameId, isAdHoc);
        return;
      }

      const description = await this.buildDescription(eventId, eventData);
      const startTime = new Date(eventData.startTime);
      const endTime = new Date(eventData.endTime);

      try {
        await guild.scheduledEvents.edit(event.discordScheduledEventId, {
          name: eventData.title,
          scheduledStartTime: startTime,
          scheduledEndTime: endTime,
          description,
        });

        this.logger.log(
          `Updated Discord Scheduled Event ${event.discordScheduledEventId} for event ${eventId}`,
        );
      } catch (editError) {
        if (
          editError instanceof DiscordAPIError &&
          editError.code === UNKNOWN_SCHEDULED_EVENT
        ) {
          // Manual deletion in Discord — clear ID and recreate
          this.logger.warn(
            `Scheduled event ${event.discordScheduledEventId} was deleted in Discord, recreating for event ${eventId}`,
          );
          await this.db
            .update(schema.events)
            .set({ discordScheduledEventId: null })
            .where(eq(schema.events.id, eventId));
          await this.createScheduledEvent(eventId, eventData, gameId, isAdHoc);
        } else {
          throw editError;
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to update scheduled event for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Delete a Discord Scheduled Event (for cancel/delete).
   */
  async deleteScheduledEvent(eventId: number): Promise<void> {
    try {
      if (!this.clientService.isConnected()) return;

      const guild = this.clientService.getGuild();
      if (!guild) return;

      const [event] = await this.db
        .select({
          discordScheduledEventId: schema.events.discordScheduledEventId,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event?.discordScheduledEventId) return;

      try {
        await guild.scheduledEvents.delete(event.discordScheduledEventId);
        this.logger.log(
          `Deleted Discord Scheduled Event ${event.discordScheduledEventId} for event ${eventId}`,
        );
      } catch (deleteError) {
        if (
          deleteError instanceof DiscordAPIError &&
          deleteError.code === UNKNOWN_SCHEDULED_EVENT
        ) {
          this.logger.debug(
            `Scheduled event ${event.discordScheduledEventId} already deleted in Discord`,
          );
        } else {
          throw deleteError;
        }
      }

      await this.db
        .update(schema.events)
        .set({ discordScheduledEventId: null })
        .where(eq(schema.events.id, eventId));
    } catch (error) {
      this.logger.error(
        `Failed to delete scheduled event for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Update only the description of a Discord Scheduled Event (signup count changes).
   */
  async updateDescription(
    eventId: number,
    eventData: ScheduledEventData,
  ): Promise<void> {
    try {
      if (!this.clientService.isConnected()) return;

      const guild = this.clientService.getGuild();
      if (!guild) return;

      const [event] = await this.db
        .select({
          discordScheduledEventId: schema.events.discordScheduledEventId,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event?.discordScheduledEventId) return;

      const description = await this.buildDescription(eventId, eventData);

      try {
        await guild.scheduledEvents.edit(event.discordScheduledEventId, {
          description,
        });
        this.logger.debug(
          `Updated description for scheduled event ${event.discordScheduledEventId}`,
        );
      } catch (editError) {
        if (
          editError instanceof DiscordAPIError &&
          editError.code === UNKNOWN_SCHEDULED_EVENT
        ) {
          this.logger.debug(
            `Scheduled event ${event.discordScheduledEventId} was deleted in Discord, clearing reference`,
          );
          await this.db
            .update(schema.events)
            .set({ discordScheduledEventId: null })
            .where(eq(schema.events.id, eventId));
        } else {
          throw editError;
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to update scheduled event description for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Build the description for a Discord Scheduled Event.
   * Format:
   *   {gameName} — {signupCount}/{maxAttendees} signed up
   *   {eventDescription (truncated)}
   *
   *   View event: {CLIENT_URL}/events/{eventId}
   *
   * Truncated to 1000 chars total.
   */
  private async buildDescription(
    eventId: number,
    eventData: ScheduledEventData,
  ): Promise<string> {
    const clientUrl = await this.settingsService.getClientUrl();
    const link = clientUrl
      ? `\n\nView event: ${clientUrl}/events/${eventId}`
      : '';

    const gameName = eventData.game?.name ?? 'Event';
    const attendeeStr = eventData.maxAttendees
      ? `${eventData.signupCount}/${eventData.maxAttendees}`
      : `${eventData.signupCount}`;

    const header = `${gameName} — ${attendeeStr} signed up`;
    const eventDesc = eventData.description ?? '';

    const full = eventDesc
      ? `${header}\n${eventDesc}${link}`
      : `${header}${link}`;

    if (full.length <= MAX_DESCRIPTION_LENGTH) {
      return full;
    }

    // Truncate event description to fit within limit, preserving header + link
    const headerAndLink = `${header}${link}`;
    if (headerAndLink.length >= MAX_DESCRIPTION_LENGTH) {
      return headerAndLink.slice(0, MAX_DESCRIPTION_LENGTH - 3) + '...';
    }

    // Available space: total - header - "\n" - link - "..."
    const available =
      MAX_DESCRIPTION_LENGTH - header.length - 1 - link.length - 3;
    const truncatedDesc =
      available > 0 ? eventDesc.slice(0, available) + '...' : '';
    return truncatedDesc
      ? `${header}\n${truncatedDesc}${link}`
      : `${header}${link}`;
  }
}
