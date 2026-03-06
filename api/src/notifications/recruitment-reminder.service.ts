import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';
import {
  type EligibleEvent, findEligibleEvents, findRecipients,
  findAbsentUsers, buildSignupSummary, buildDiscordUrl,
} from './recruitment-reminder.helpers';

/** TTL for recruitment-reminder dedup keys: 48 hours in seconds */
const DEDUP_TTL_SECONDS = 48 * 60 * 60;

/**
 * Sends recruitment reminder DMs and bumps the embed ~24 hours before
 * an event that still has open spots (ROK-535).
 */
@Injectable()
export class RecruitmentReminderService {
  private readonly logger = new Logger(RecruitmentReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private readonly notificationService: NotificationService,
    private readonly settingsService: SettingsService,
    private readonly discordBotClient: DiscordBotClientService,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron('45 */15 * * * *', { name: 'RecruitmentReminderService_checkAndSendReminders' })
  async handleCron(): Promise<void> {
    await this.cronJobService.executeWithTracking('RecruitmentReminderService_checkAndSendReminders', async () => { await this.checkAndSendReminders(); });
  }

  /** Check and send recruitment reminders for eligible events. */
  async checkAndSendReminders(): Promise<void> {
    const events = await findEligibleEvents(this.db);
    if (events.length === 0) return;
    this.logger.log(`Found ${events.length} eligible events for recruitment reminders`);

    for (const event of events) {
      await this.processEvent(event);
    }
  }

  /** Process a single eligible event for bumps and DMs. */
  private async processEvent(event: EligibleEvent): Promise<void> {
    const hoursUntilStart = (new Date(event.startTime).getTime() - Date.now()) / (1000 * 60 * 60);

    const bumpKey = `recruitment-bump:event:${event.id}`;
    if (!(await this.redis.get(bumpKey))) {
      await this.redis.set(bumpKey, '1', 'EX', DEDUP_TTL_SECONDS);
      await this.postChannelBump(event);
    }

    if (hoursUntilStart > 24) {
      this.logger.debug(`Event ${event.id} starts in ${hoursUntilStart.toFixed(1)}h — bump sent, DMs deferred`);
      return;
    }

    const dmKey = `recruitment-dm:event:${event.id}`;
    if (await this.redis.get(dmKey)) {
      this.logger.debug(`Recruitment DMs already sent for event ${event.id}, skipping`);
      return;
    }

    let recipientIds = await findRecipients(this.db, event.gameId, event.creatorId, event.id);
    recipientIds = await this.filterAbsentUsers(recipientIds, event);
    await this.redis.set(dmKey, '1', 'EX', DEDUP_TTL_SECONDS);

    if (recipientIds.length > 0) {
      await this.sendRecruitmentDMs(event, recipientIds);
    } else {
      this.logger.debug(`No recruitment reminder recipients for event ${event.id}`);
    }
  }

  /** Filter out users with active absences covering the event date. */
  private async filterAbsentUsers(recipientIds: number[], event: EligibleEvent): Promise<number[]> {
    if (recipientIds.length === 0) return recipientIds;
    const absentUserIds = await findAbsentUsers(this.db, recipientIds, event.startTime);
    if (absentUserIds.size > 0) {
      this.logger.debug(`Excluded ${absentUserIds.size} absent users from recruitment reminder for event ${event.id}`);
      return recipientIds.filter((id) => !absentUserIds.has(id));
    }
    return recipientIds;
  }

  /** Send recruitment reminder DMs to all eligible recipients. */
  private async sendRecruitmentDMs(event: EligibleEvent, recipientIds: number[]): Promise<void> {
    const defaultTimezone = (await this.settingsService.getDefaultTimezone()) ?? 'UTC';
    const clientUrl = (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173';
    const eventDate = new Date(event.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: defaultTimezone });
    const signupSummary = buildSignupSummary(event);
    const message = `Spots available for ${event.gameName}: ${event.title} on ${eventDate}. ${signupSummary} — sign up now!`;
    const discordUrl = buildDiscordUrl(event);
    const voiceChannelId = await this.notificationService.resolveVoiceChannelId(event.gameId);

    const results = await Promise.allSettled(recipientIds.map((userId) =>
      this.notificationService.create({
        userId, type: 'recruitment_reminder', title: `Spots Available — ${event.title}`, message,
        payload: { eventId: event.id, eventTitle: event.title, gameId: event.gameId, gameName: event.gameName, signupSummary, startTime: event.startTime, url: `${clientUrl}/events/${event.id}`, discordUrl, ...(voiceChannelId ? { voiceChannelId } : {}) },
      }),
    ));

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    this.logger.log(`Recruitment reminders for event ${event.id}: ${succeeded} sent, ${failed} failed (${recipientIds.length} recipients)`);
  }

  /** Post a bump message in the event's Discord channel. */
  private async postChannelBump(event: EligibleEvent): Promise<void> {
    if (!this.discordBotClient.isConnected()) { this.logger.warn(`Bot not connected — skipping channel bump for event ${event.id}`); return; }
    if (event.maxAttendees !== null && event.signupCount >= event.maxAttendees) { this.logger.debug(`Event ${event.id} is now full — skipping channel bump`); return; }

    try {
      const clientUrl = (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173';
      const { embed, row } = this.buildBumpEmbed(event, clientUrl);
      await this.discordBotClient.sendEmbed(event.channelId, embed, row);
      this.logger.log(`Posted recruitment bump for event ${event.id} in channel ${event.channelId}`);
    } catch (error) {
      this.logger.warn(`Failed to post channel bump for event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /** Build the bump embed and action row. */
  private buildBumpEmbed(event: EligibleEvent, clientUrl: string): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
    const signupSummary = buildSignupSummary(event);
    const embedUrl = buildDiscordUrl(event);
    const hoursUntil = Math.round((new Date(event.startTime).getTime() - Date.now()) / (1000 * 60 * 60));
    const timeLabel = hoursUntil <= 24 ? 'tomorrow' : `in ${hoursUntil}h`;

    const embed = new EmbedBuilder()
      .setTitle(`\uD83D\uDCE2 Spots still available — event ${timeLabel}!`)
      .setDescription(`**${event.title}** — ${event.gameName}\n${signupSummary}`)
      .setColor(EMBED_COLORS.ANNOUNCEMENT).setTimestamp(new Date(event.startTime));

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('View Event').setStyle(ButtonStyle.Link).setURL(`${clientUrl}/events/${event.id}`),
      new ButtonBuilder().setLabel('View in Discord').setStyle(ButtonStyle.Link).setURL(embedUrl),
    );
    return { embed, row };
  }
}
