import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
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
import {
  findExistingEmbedRecord,
  querySignupRows,
  queryRoleCounts,
  filterActiveSignups,
  buildSignupMentions,
  isUnknownMessageError,
} from './embed-poster.helpers';

interface ChannelOpts {
  gameId?: number | null;
  recurrenceGroupId?: string | null;
  notificationChannelOverride?: string | null;
}

/**
 * Shared embed posting logic (ROK-434).
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

  /** Post an embed for an event to the appropriate Discord channel. */
  async postEmbed(
    eventId: number,
    event: EmbedEventData,
    gameId?: number | null,
    recurrenceGroupId?: string | null,
    notificationChannelOverride?: string | null,
  ): Promise<boolean> {
    if (!this.clientService.isConnected()) return false;
    const opts: ChannelOpts = {
      gameId,
      recurrenceGroupId,
      notificationChannelOverride,
    };
    const resolved = await this.resolvePostTargets(opts);
    if (!resolved) return false;
    try {
      return await this.postOrEditEmbed(
        eventId,
        event,
        resolved.channelId,
        resolved.guildId,
        opts,
      );
    } catch (error) {
      this.logger.error(`Failed to post embed for event ${eventId}:`, error);
      return false;
    }
  }

  /** Check if an event already has a discord_event_messages row. */
  async hasEmbed(eventId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.discordEventMessages.id })
      .from(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.eventId, eventId))
      .limit(1);
    return rows.length > 0;
  }

  /** Enrich event data with live roster/signup information from the DB. */
  async enrichWithLiveRoster(
    eventId: number,
    event: EmbedEventData,
  ): Promise<EmbedEventData> {
    const signupRows = await querySignupRows(this.db, eventId);
    const activeSignups = filterActiveSignups(signupRows);
    const roleCounts = await queryRoleCounts(this.db, eventId);
    const signupMentions = buildSignupMentions(activeSignups);
    return {
      ...event,
      signupCount: activeSignups.length,
      roleCounts,
      signupMentions,
    };
  }

  // --- Private helpers ---

  private async resolvePostTargets(
    opts: ChannelOpts,
  ): Promise<{ channelId: string; guildId: string } | null> {
    const channelId = await this.channelResolver.resolveChannelForEvent(
      opts.gameId,
      opts.recurrenceGroupId,
      opts.notificationChannelOverride,
    );
    if (!channelId) return null;
    const guildId = this.clientService.getGuildId();
    if (!guildId) return null;
    return { channelId, guildId };
  }

  private async buildContext(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return { communityName: branding.communityName, clientUrl, timezone };
  }

  private async postOrEditEmbed(
    eventId: number,
    event: EmbedEventData,
    channelId: string,
    guildId: string,
    opts: ChannelOpts,
  ): Promise<boolean> {
    const existing = await findExistingEmbedRecord(this.db, eventId, guildId);
    const enrichedEvent = await this.enrichWithLiveRoster(eventId, event);
    await this.applyVoiceChannel(enrichedEvent, opts);
    const context = await this.buildContext();
    const { embed, row, content } = this.embedFactory.buildEventEmbed(
      enrichedEvent,
      context,
    );
    if (existing)
      return this.editExistingEmbed(
        eventId,
        existing,
        embed,
        row,
        opts,
        content,
      );
    return this.postNewEmbed(eventId, channelId, guildId, embed, row, content);
  }

  private async applyVoiceChannel(
    enrichedEvent: EmbedEventData,
    opts: ChannelOpts,
  ): Promise<void> {
    const voiceChannelId =
      opts.notificationChannelOverride ??
      (await this.channelResolver.resolveVoiceChannelForScheduledEvent(
        opts.gameId,
        opts.recurrenceGroupId,
      ));
    if (voiceChannelId) enrichedEvent.voiceChannelId = voiceChannelId;
  }

  private async postNewEmbed(
    eventId: number,
    channelId: string,
    guildId: string,
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
    content?: string,
  ): Promise<boolean> {
    const message = await this.clientService.sendEmbed(
      channelId,
      embed,
      row,
      content,
    );
    await this.db.insert(schema.discordEventMessages).values({
      eventId,
      guildId,
      channelId,
      messageId: message.id,
      embedState: EMBED_STATES.POSTED,
    });
    this.logger.log(`Posted embed for event ${eventId} (msg: ${message.id})`);
    return true;
  }

  private async editExistingEmbed(
    eventId: number,
    record: { id: string; channelId: string; messageId: string },
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
    opts?: ChannelOpts,
    content?: string,
  ): Promise<boolean> {
    try {
      await this.clientService.editEmbed(
        record.channelId,
        record.messageId,
        embed,
        row,
        content,
      );
      this.logger.log(
        `Edited existing embed for event ${eventId} (msg: ${record.messageId})`,
      );
      return true;
    } catch (editError) {
      if (!isUnknownMessageError(editError)) {
        this.logger.error(
          `Failed to edit embed for event ${eventId}:`,
          editError,
        );
        return false;
      }
      return this.replaceDeletedEmbed(
        eventId,
        record.id,
        embed,
        row,
        opts,
        content,
      );
    }
  }

  private async replaceDeletedEmbed(
    eventId: number,
    recordId: string,
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
    opts?: ChannelOpts,
    content?: string,
  ): Promise<boolean> {
    this.logger.warn(
      `Existing embed for event ${eventId} was deleted, posting replacement`,
    );
    const guildId = this.clientService.getGuildId();
    if (!guildId) return false;
    const channelId = await this.channelResolver.resolveChannelForEvent(
      opts?.gameId,
      opts?.recurrenceGroupId,
      opts?.notificationChannelOverride,
    );
    if (!channelId) return false;
    const message = await this.clientService.sendEmbed(
      channelId,
      embed,
      row,
      content,
    );
    await this.db
      .update(schema.discordEventMessages)
      .set({ channelId, messageId: message.id, updatedAt: new Date() })
      .where(eq(schema.discordEventMessages.id, recordId));
    this.logger.log(
      `Posted replacement embed for event ${eventId} (msg: ${message.id})`,
    );
    return true;
  }
}
