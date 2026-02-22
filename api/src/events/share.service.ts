import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../discord-bot/services/discord-embed.factory';
import { SettingsService } from '../settings/settings.service';
import { EventsService } from './events.service';
import type { ShareEventResponseDto } from '@raid-ledger/contract';

/**
 * Share events to bound Discord channels (ROK-263).
 */
@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Post an event announcement embed to all game-bound text channels.
   * Skips channels where the event was already posted (dedup via discord_event_messages).
   */
  async shareToDiscordChannels(
    eventId: number,
  ): Promise<ShareEventResponseDto> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) {
      return { channelsPosted: 0, channelsSkipped: 0 };
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
      return { channelsPosted: 0, channelsSkipped: 0 };
    }

    // Fetch full event data including role counts and signup mentions
    const event = await this.eventsService.findOne(eventId);
    if (event.cancelledAt) {
      return { channelsPosted: 0, channelsSkipped: 0 };
    }

    const eventData = await this.eventsService.buildEmbedEventData(eventId);

    // Use the IGDB game ID from the event for channel binding lookup
    const gameId = event.game?.id ?? null;

    // Find bound channels for this game
    const bindings = await this.db
      .select()
      .from(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.guildId, guild.id),
          eq(schema.channelBindings.bindingPurpose, 'game-announcements'),
          ...(gameId ? [eq(schema.channelBindings.gameId, gameId)] : []),
        ),
      );

    if (bindings.length === 0) {
      // No game-specific binding — fall back to default notification channel
      const defaultChannelId =
        await this.settingsService.getDiscordBotDefaultChannel();
      if (defaultChannelId) {
        bindings.push({ channelId: defaultChannelId } as (typeof bindings)[0]);
      } else {
        return { channelsPosted: 0, channelsSkipped: 0 };
      }
    }

    // Check which channels already have posts for this event
    const existingMessages = await this.db
      .select({ channelId: schema.discordEventMessages.channelId })
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, eventId),
          eq(schema.discordEventMessages.guildId, guild.id),
        ),
      );

    const postedChannelIds = new Set(existingMessages.map((m) => m.channelId));

    const context = await this.buildContext();
    let channelsPosted = 0;
    let channelsSkipped = 0;

    for (const binding of bindings) {
      if (postedChannelIds.has(binding.channelId)) {
        channelsSkipped++;
        continue;
      }

      try {
        const channel = await guild.channels.fetch(binding.channelId);
        if (!channel || !channel.isTextBased() || channel.isDMBased()) {
          channelsSkipped++;
          continue;
        }

        const { embed, row } = this.embedFactory.buildEventEmbed(
          eventData,
          context,
        );

        const message = await channel.send({
          embeds: [embed],
          ...(row ? { components: [row] } : {}),
        });

        // Store reference for dedup and future updates
        await this.db.insert(schema.discordEventMessages).values({
          eventId,
          guildId: guild.id,
          channelId: binding.channelId,
          messageId: message.id,
          embedState: 'posted',
        });

        channelsPosted++;
        this.logger.log(
          'Shared event %d to channel %s',
          eventId,
          binding.channelId,
        );
      } catch (error) {
        this.logger.warn(
          'Failed to share event %d to channel %s: %s',
          eventId,
          binding.channelId,
          error instanceof Error ? error.message : 'Unknown error',
        );
        channelsSkipped++;
      }
    }

    return { channelsPosted, channelsSkipped };
  }

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
