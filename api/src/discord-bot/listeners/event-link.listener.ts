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
    if (message.author.bot) return;
    if (recentlyProcessed.has(message.id)) return;
    recentlyProcessed.set(message.id, Date.now());
    if (!message.guild) return;
    if (!isGuildTextChannel(message.channel.type)) return;
    const clientUrl = resolveClientUrl();
    if (!clientUrl) {
      this.logger.warn('CLIENT_URL not set — link unfurl disabled');
      return;
    }
    const hostPattern = buildHostPattern(clientUrl);
    if (!hostPattern) {
      this.logger.warn(`CLIENT_URL is not a valid URL: ${clientUrl}`);
      return;
    }
    const parsed = parseMessageLinks(message.content, hostPattern);
    if (!parsed.eventIds.length && !parsed.inviteCodes.length) {
      warnOnMissedLinks(message, hostPattern, this.logger);
      return;
    }
    await this.unfurlAndReply(message, parsed, clientUrl);
  }

  /** Build embeds for matched links and reply. */
  private async unfurlAndReply(
    message: Message,
    parsed: ParsedLinks,
    clientUrl: string,
  ): Promise<void> {
    const ctx = await this.buildContext();
    const result = await this.buildUnfurlEmbeds(parsed, ctx, clientUrl);
    if (result.embeds.length === 0) return;
    const reply = await message.reply({
      embeds: result.embeds,
      ...(result.rows.length > 0 ? { components: result.rows } : {}),
    });
    await this.suppressOriginalEmbeds(message);
    await this.trackUnfurlMessages(message, reply, result.eventIds);
  }

  /** Build embeds/rows for event and invite links. */
  private async buildUnfurlEmbeds(
    parsed: ParsedLinks,
    ctx: EmbedContext,
    clientUrl: string,
  ): Promise<UnfurlResult> {
    const embeds: EmbedBuilder[] = [];
    const rows: ActionRowType<ButtonType>[] = [];
    const eventIds: number[] = [];
    for (const id of parsed.eventIds) {
      const r = await this.unfurlEventLink(id, ctx);
      if (!r) continue;
      embeds.push(r.embed);
      if (r.row) rows.push(r.row);
      eventIds.push(id);
    }
    for (const code of parsed.inviteCodes) {
      const r = await this.unfurlInviteLink(code, ctx, clientUrl);
      if (!r) continue;
      embeds.push(r.embed);
      rows.push(r.row);
      if (!eventIds.includes(r.eventId)) eventIds.push(r.eventId);
    }
    return { embeds, rows, eventIds };
  }

  /** Unfurl a single event link. */
  private async unfurlEventLink(
    eventId: number,
    ctx: EmbedContext,
  ): Promise<{ embed: EmbedBuilder; row?: ActionRowType<ButtonType> } | null> {
    try {
      const event = await this.eventsService.findOne(eventId);
      if (event.cancelledAt) return null;
      const data = await this.eventsService.buildEmbedEventData(eventId);
      return this.embedFactory.buildEventEmbed(data, ctx, {
        buttons: 'signup',
      });
    } catch {
      return null;
    }
  }

  /** Unfurl a single invite link. */
  private async unfurlInviteLink(
    code: string,
    ctx: EmbedContext,
    clientUrl: string,
  ): Promise<InviteUnfurl | null> {
    try {
      const slot = await this.pugsService.findByInviteCode(code);
      if (!slot) return null;
      const event = await this.eventsService.findOne(slot.eventId);
      if (event.cancelledAt) return null;
      const data = await this.eventsService.buildEmbedEventData(slot.eventId);
      const { embed } = this.embedFactory.buildEventEmbed(data, ctx, {
        buttons: 'none',
      });
      const row = buildInviteButtonRow(code, clientUrl, event.id);
      return { embed, row, eventId: slot.eventId };
    } catch {
      return null;
    }
  }

  /** Suppress Discord's OG embed preview on the original message. */
  private async suppressOriginalEmbeds(message: Message): Promise<void> {
    try {
      await message.suppressEmbeds(true);
    } catch (err) {
      this.logger.warn(
        `Failed to suppress embeds on ${message.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }
  }

  /** Track unfurl messages in discord_event_messages for embed sync. */
  private async trackUnfurlMessages(
    message: Message,
    reply: Message,
    eventIds: number[],
  ): Promise<void> {
    const guildId = message.guild?.id;
    if (!guildId || !reply.id) return;
    for (const eventId of eventIds) {
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
          `Failed to track unfurl for event ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
        );
      }
    }
  }

  private async buildContext(): Promise<EmbedContext> {
    const [branding, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return {
      communityName: branding.communityName,
      clientUrl:
        (process.env.CLIENT_URL || process.env.CORS_ORIGIN || null) === 'auto'
          ? null
          : process.env.CLIENT_URL || process.env.CORS_ORIGIN || null,
      timezone,
    };
  }
}

// --- Pure helpers ---

interface ParsedLinks {
  eventIds: number[];
  inviteCodes: string[];
}

interface UnfurlResult {
  embeds: EmbedBuilder[];
  rows: ActionRowType<ButtonType>[];
  eventIds: number[];
}

function isGuildTextChannel(type: ChannelType): boolean {
  return (
    type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement
  );
}

function resolveClientUrl(): string {
  const raw = process.env.CLIENT_URL || process.env.CORS_ORIGIN || '';
  return raw !== 'auto' ? raw.replace(/\/+$/, '') : '';
}

function buildHostPattern(clientUrl: string): string | null {
  try {
    const parsed = new URL(clientUrl);
    const escaped = parsed.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${escaped}${port}`;
  } catch {
    return null;
  }
}

function parseMessageLinks(content: string, hostPattern: string): ParsedLinks {
  const eventPattern = new RegExp(`https?://${hostPattern}/events/(\\d+)`, 'g');
  const invitePattern = new RegExp(
    `https?://${hostPattern}/i/([a-z2-9]{8})`,
    'g',
  );
  const eventIds = extractUniqueMatches(eventPattern, content, (m) =>
    parseInt(m, 10),
  );
  const inviteCodes = extractUniqueMatches(invitePattern, content, (m) => m);
  return { eventIds, inviteCodes };
}

function extractUniqueMatches<T>(
  pattern: RegExp,
  content: string,
  transform: (match: string) => T,
): T[] {
  const results: T[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const val = transform(match[1]);
    if (!results.includes(val)) results.push(val);
    if (results.length >= MAX_UNFURLS_PER_MESSAGE) break;
  }
  return results;
}

function warnOnMissedLinks(
  message: Message,
  hostPattern: string,
  logger: Logger,
): void {
  const generic = /https?:\/\/[^\s/]+\/events\/\d+/i;
  if (generic.test(message.content)) {
    logger.warn(
      `Event-like URL found but no match for host "${hostPattern}": ${message.content.substring(0, 200)}`,
    );
  }
}

interface InviteUnfurl {
  embed: EmbedBuilder;
  row: ActionRowType<ButtonType>;
  eventId: number;
}

function buildInviteButtonRow(
  code: string,
  clientUrl: string,
  eventId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pug_join:${code}`)
      .setLabel('Join Event')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setLabel('View Event')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/events/${eventId}`),
  );
}
