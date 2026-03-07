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
    const guild = this.getReadyGuild();
    if (!guild) return { channelsPosted: 0, channelsSkipped: 0 };

    const event = await this.eventsService.findOne(eventId);
    if (event.cancelledAt) return { channelsPosted: 0, channelsSkipped: 0 };

    const bindings = await this.resolveBindings(
      guild.id,
      event.game?.id ?? null,
    );
    if (bindings.length === 0) return { channelsPosted: 0, channelsSkipped: 0 };

    const postedChannelIds = await this.getAlreadyPostedChannels(
      eventId,
      guild.id,
    );
    const eventData = await this.eventsService.buildEmbedEventData(eventId);
    const context = await this.buildContext();

    return this.postToChannels(
      guild,
      bindings,
      postedChannelIds,
      eventId,
      eventData,
      context,
    );
  }

  private getReadyGuild() {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;
    return client.guilds.cache.first() ?? null;
  }

  private async resolveBindings(guildId: string, gameId: number | null) {
    const conditions = [
      eq(schema.channelBindings.guildId, guildId),
      eq(schema.channelBindings.bindingPurpose, 'game-announcements'),
      ...(gameId ? [eq(schema.channelBindings.gameId, gameId)] : []),
    ];
    const bindings = await this.db
      .select()
      .from(schema.channelBindings)
      .where(and(...conditions));

    if (bindings.length === 0) {
      const defaultChannelId =
        await this.settingsService.getDiscordBotDefaultChannel();
      if (defaultChannelId) {
        bindings.push({ channelId: defaultChannelId } as (typeof bindings)[0]);
      }
    }
    return bindings;
  }

  private async getAlreadyPostedChannels(eventId: number, guildId: string) {
    const existing = await this.db
      .select({ channelId: schema.discordEventMessages.channelId })
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      );
    return new Set(existing.map((m) => m.channelId));
  }

  private async postToChannels(
    guild: any,
    bindings: { channelId: string }[],
    postedChannelIds: Set<string>,
    eventId: number,
    eventData: any,
    context: EmbedContext,
  ): Promise<ShareEventResponseDto> {
    let channelsPosted = 0;
    let channelsSkipped = 0;

    for (const binding of bindings) {
      if (postedChannelIds.has(binding.channelId)) {
        channelsSkipped++;
        continue;
      }
      const posted = await this.postToChannel(
        guild,
        binding.channelId,
        eventId,
        eventData,
        context,
      );
      if (posted) channelsPosted++;
      else channelsSkipped++;
    }

    return { channelsPosted, channelsSkipped };
  }

  private async postToChannel(
    guild: any,
    channelId: string,
    eventId: number,
    eventData: any,
    context: EmbedContext,
  ): Promise<boolean> {
    try {
      return await this.trySendEmbed(
        guild,
        channelId,
        eventId,
        eventData,
        context,
      );
    } catch (error) {
      this.logShareFailure(eventId, channelId, error);
      return false;
    }
  }

  private async trySendEmbed(
    guild: any,
    channelId: string,
    eventId: number,
    eventData: any,
    context: EmbedContext,
  ): Promise<boolean> {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return false;

    const { embed, row } = this.embedFactory.buildEventEmbed(
      eventData,
      context,
    );
    const message = await channel.send({
      embeds: [embed],
      ...(row ? { components: [row] } : {}),
    });

    await this.recordPostedMessage(eventId, guild.id, channelId, message.id);
    return true;
  }

  private async recordPostedMessage(
    eventId: number,
    guildId: string,
    channelId: string,
    messageId: string,
  ) {
    await this.db.insert(schema.discordEventMessages).values({
      eventId,
      guildId,
      channelId,
      messageId,
      embedState: 'posted',
    });
    this.logger.log('Shared event %d to channel %s', eventId, channelId);
  }

  private logShareFailure(eventId: number, channelId: string, error: unknown) {
    this.logger.warn(
      'Failed to share event %d to channel %s: %s',
      eventId,
      channelId,
      error instanceof Error ? error.message : 'Unknown error',
    );
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
