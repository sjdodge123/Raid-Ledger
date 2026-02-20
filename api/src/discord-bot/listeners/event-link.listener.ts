import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
  type EmbedBuilder,
  type ActionRowBuilder as ActionRowType,
  type ButtonBuilder as ButtonType,
} from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { EventsService } from '../../events/events.service';
import { PugsService } from '../../events/pugs.service';
import { DISCORD_BOT_EVENTS, EMBED_STATES } from '../discord-bot.constants';

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
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
    private readonly pugsService: PugsService,
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

    // Escape special regex chars in the URL, then match /events/:id and /i/:code
    const escapedUrl = clientUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const eventPattern = new RegExp(`${escapedUrl}/events/(\\d+)`, 'g');
    const invitePattern = new RegExp(`${escapedUrl}/i/([a-z2-9]{8})`, 'g');

    const eventMatches: number[] = [];
    const inviteCodes: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = eventPattern.exec(message.content)) !== null) {
      const eventId = parseInt(match[1], 10);
      if (!eventMatches.includes(eventId)) {
        eventMatches.push(eventId);
      }
      if (eventMatches.length >= MAX_UNFURLS_PER_MESSAGE) break;
    }

    while ((match = invitePattern.exec(message.content)) !== null) {
      const code = match[1];
      if (!inviteCodes.includes(code)) {
        inviteCodes.push(code);
      }
      if (inviteCodes.length >= MAX_UNFURLS_PER_MESSAGE) break;
    }

    if (eventMatches.length === 0 && inviteCodes.length === 0) return;

    const context = await this.buildContext();
    const embeds: EmbedBuilder[] = [];
    const rows: ActionRowType<ButtonType>[] = [];
    const unfurledEventIds: number[] = [];

    // Unfurl event links — full embed with roster breakdown
    for (const eventId of eventMatches) {
      try {
        const event = await this.eventsService.findOne(eventId);
        if (event.cancelledAt) continue;

        const eventData = await this.eventsService.buildEmbedEventData(eventId);
        const { embed, row } = this.embedFactory.buildEventEmbed(
          eventData,
          context,
          { buttons: 'signup' },
        );

        embeds.push(embed);
        if (row) rows.push(row);
        unfurledEventIds.push(eventId);
      } catch {
        // Event not found or other error — silently ignore
      }
    }

    // Unfurl invite links (ROK-263) — full embed with roster breakdown
    for (const code of inviteCodes) {
      try {
        const slot = await this.pugsService.findByInviteCode(code);
        if (!slot) continue;

        const event = await this.eventsService.findOne(slot.eventId);
        if (event.cancelledAt) continue;

        const eventData = await this.eventsService.buildEmbedEventData(
          slot.eventId,
        );
        const { embed } = this.embedFactory.buildEventEmbed(
          eventData,
          context,
          { buttons: 'none' },
        );
        embeds.push(embed);

        // Add "Join Event" interactive button + "View Event" link button
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`pug_join:${code}`)
            .setLabel('Join Event')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setLabel('View Event')
            .setStyle(ButtonStyle.Link)
            .setURL(`${clientUrl}/events/${event.id}`),
        );
        rows.push(row);
        if (!unfurledEventIds.includes(slot.eventId)) {
          unfurledEventIds.push(slot.eventId);
        }
      } catch {
        // Slot/event not found — silently ignore
      }
    }

    if (embeds.length === 0) return;

    // Send all embeds in a single reply
    const reply = await message.reply({
      embeds,
      ...(rows.length > 0 ? { components: rows } : {}),
    });

    // Track unfurl reply in discord_event_messages so embed sync updates it
    const guildId = message.guild?.id;
    if (guildId && reply.id) {
      for (const eventId of unfurledEventIds) {
        try {
          await this.db
            .insert(schema.discordEventMessages)
            .values({
              eventId,
              guildId,
              channelId: message.channel.id,
              messageId: reply.id,
              embedState: EMBED_STATES.POSTED,
            })
            .onConflictDoNothing();
        } catch (err) {
          this.logger.warn(
            `Failed to track unfurl message for event ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
          );
        }
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
