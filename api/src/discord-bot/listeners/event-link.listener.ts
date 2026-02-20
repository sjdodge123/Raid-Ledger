import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events, ChannelType, type Message } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { EventsService } from '../../events/events.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';

const MAX_UNFURLS_PER_MESSAGE = 3;

/**
 * Listener that auto-unfurls Raid Ledger event links posted in Discord channels (ROK-380).
 *
 * When a message containing a CLIENT_URL/events/:id URL is posted in a guild text channel,
 * the bot replies with a compact event preview embed.
 */
@Injectable()
export class EventLinkListener {
  private readonly logger = new Logger(EventLinkListener.name);
  private listenerAttached = false;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client || this.listenerAttached) return;

    client.on(Events.MessageCreate, (message: Message) => {
      this.handleMessage(message).catch((err: unknown) => {
        this.logger.error('Error handling messageCreate for link unfurl:', err);
      });
    });

    this.listenerAttached = true;
    this.logger.log('Event link unfurl listener attached');
  }

  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.listenerAttached = false;
  }

  private async handleMessage(message: Message): Promise<void> {
    // Skip bot messages (prevents self-reply loops)
    if (message.author.bot) return;

    // Only unfurl in guild text channels (not DMs)
    if (!message.guild) return;
    if (
      message.channel.type !== ChannelType.GuildText &&
      message.channel.type !== ChannelType.GuildAnnouncement
    ) {
      return;
    }

    const clientUrl = process.env.CLIENT_URL;
    if (!clientUrl) return;

    // Escape special regex chars in the URL, then match /events/:id
    const escapedUrl = clientUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedUrl}/events/(\\d+)`, 'g');
    const matches: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(message.content)) !== null) {
      const eventId = parseInt(match[1], 10);
      if (!matches.includes(eventId)) {
        matches.push(eventId);
      }
      if (matches.length >= MAX_UNFURLS_PER_MESSAGE) break;
    }

    if (matches.length === 0) return;

    const context = await this.buildContext();

    for (const eventId of matches) {
      try {
        const event = await this.eventsService.findOne(eventId);

        // Skip cancelled events
        if (event.cancelledAt) continue;

        const { embed, row } = this.embedFactory.buildEventPreview(
          {
            id: event.id,
            title: event.title,
            startTime: event.startTime,
            endTime: event.endTime,
            signupCount: event.signupCount,
            game: event.game,
          },
          context,
        );

        await message.reply({
          embeds: [embed],
          ...(row ? { components: [row] } : {}),
        });
      } catch {
        // Event not found or other error — silently ignore
      }
    }
  }

  private async buildContext(): Promise<EmbedContext> {
    const branding = await this.settingsService.getBranding();
    return {
      communityName: branding.communityName,
      clientUrl: process.env.CLIENT_URL ?? null,
    };
  }
}
