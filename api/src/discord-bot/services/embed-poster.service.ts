import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { EMBED_STATES } from '../discord-bot.constants';

/**
 * Shared embed posting logic (ROK-434).
 *
 * Extracted from DiscordEventListener so that both the event listener
 * and the EmbedSchedulerService can post embeds without duplication.
 */
@Injectable()
export class EmbedPosterService {
  private readonly logger = new Logger(EmbedPosterService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Post an embed for an event to the appropriate Discord channel.
   * Resolves the channel, builds the embed, sends it, and inserts the
   * tracking row into discord_event_messages.
   *
   * @param eventId - The event ID
   * @param event - Event data for embed construction
   * @param gameId - Optional game ID for channel resolution
   * @returns true if the embed was posted successfully, false otherwise
   */
  async postEmbed(
    eventId: number,
    event: EmbedEventData,
    gameId?: number | null,
    recurrenceGroupId?: string | null,
  ): Promise<boolean> {
    if (!this.clientService.isConnected()) {
      this.logger.debug('Bot not connected, skipping embed post');
      return false;
    }

    const channelId = await this.channelResolver.resolveChannelForEvent(
      gameId,
      recurrenceGroupId,
    );
    if (!channelId) return false;

    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.logger.warn('Bot is not in any guild, skipping embed post');
      return false;
    }

    try {
      // Enrich with live roster data so the embed reflects current signups
      const enrichedEvent = await this.enrichWithLiveRoster(eventId, event);
      const context = await this.buildContext();
      const { embed, row } = this.embedFactory.buildEventEmbed(
        enrichedEvent,
        context,
      );

      const message = await this.clientService.sendEmbed(channelId, embed, row);

      await this.db.insert(schema.discordEventMessages).values({
        eventId,
        guildId,
        channelId,
        messageId: message.id,
        embedState: EMBED_STATES.POSTED,
      });

      this.logger.log(
        `Posted event embed for event ${eventId} to channel ${channelId} (msg: ${message.id})`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to post event embed for event ${eventId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Check if an event already has a discord_event_messages row.
   */
  async hasEmbed(eventId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.discordEventMessages.id })
      .from(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.eventId, eventId))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Enrich event data with live roster/signup information from the DB.
   * The caller's payload may have stale or empty signup data (e.g. scheduler
   * hardcodes signupCount: 0). This queries the current state so the embed
   * is accurate at post time.
   */
  private async enrichWithLiveRoster(
    eventId: number,
    event: EmbedEventData,
  ): Promise<EmbedEventData> {
    const signupRows = await this.db
      .select({
        discordId: sql<
          string | null
        >`COALESCE(${schema.users.discordId}, ${schema.eventSignups.discordUserId})`,
        username: schema.users.username,
        role: schema.rosterAssignments.role,
        status: schema.eventSignups.status,
        preferredRoles: schema.eventSignups.preferredRoles,
      })
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.rosterAssignments,
        eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
      )
      .where(eq(schema.eventSignups.eventId, eventId));

    const activeSignups = signupRows.filter((r) => r.status !== 'declined');

    const roleRows = await this.db
      .select({
        role: schema.rosterAssignments.role,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          sql`${schema.eventSignups.status} != 'declined'`,
        ),
      )
      .groupBy(schema.rosterAssignments.role);

    const roleCounts: Record<string, number> = {};
    for (const row of roleRows) {
      if (row.role) roleCounts[row.role] = row.count;
    }

    const signupMentions = activeSignups
      .filter((r) => r.discordId !== null || r.username !== null)
      .map((r) => ({
        discordId: r.discordId,
        username: r.username,
        role: r.role ?? null,
        preferredRoles: r.preferredRoles,
        status: r.status ?? null,
      }));

    return {
      ...event,
      signupCount: activeSignups.length,
      roleCounts,
      signupMentions,
    };
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
