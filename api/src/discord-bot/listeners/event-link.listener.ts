import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  ChannelType,
  type Message,
  type EmbedBuilder,
  type ActionRowBuilder,
  type ButtonBuilder,
} from 'discord.js';
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
 * Module-scoped dedup set — prevents duplicate unfurls when dev-mode HMR
 * creates multiple EventLinkListener instances pointing at surviving Client objects.
 * Entries auto-expire after 30 seconds.
 */
const recentlyProcessed = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of recentlyProcessed) {
    if (now - ts > 30_000) recentlyProcessed.delete(id);
  }
}, 30_000).unref();

/**
 * Listener that auto-unfurls Raid Ledger event links posted in Discord channels (ROK-380).
 *
 * When a message containing a CLIENT_URL/events/:id URL is posted in a guild text channel,
 * the bot replies with a single embed (or multiple embeds for multiple links).
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

    // Module-scoped dedup: prevent duplicate unfurls from HMR ghost instances
    if (recentlyProcessed.has(message.id)) return;
    recentlyProcessed.set(message.id, Date.now());

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
    const embeds: EmbedBuilder[] = [];
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

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

        embeds.push(embed);
        if (row) rows.push(row);
      } catch {
        // Event not found or other error — silently ignore
      }
    }

    if (embeds.length === 0) return;

    // Send all embeds in a single reply
    await message.reply({
      embeds,
      ...(rows.length > 0 ? { components: rows } : {}),
    });
  }

  private async buildContext(): Promise<EmbedContext> {
    const branding = await this.settingsService.getBranding();
    return {
      communityName: branding.communityName,
      clientUrl: process.env.CLIENT_URL ?? null,
    };
  }
}
