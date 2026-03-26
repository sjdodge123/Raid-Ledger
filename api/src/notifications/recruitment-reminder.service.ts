import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';
import {
  type EligibleEvent,
  findEligibleEvents,
  findRecipients,
  findAbsentUsers,
  buildSignupSummary,
  buildDiscordUrl,
  isWithinGracePeriod,
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
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
    private readonly discordBotClient: DiscordBotClientService,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron('45 */15 * * * *', {
    name: 'RecruitmentReminderService_checkAndSendReminders',
  })
  async handleCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'RecruitmentReminderService_checkAndSendReminders',
      () => this.checkAndSendReminders(),
    );
  }

  /** Check and send recruitment reminders for eligible events. */
  async checkAndSendReminders(): Promise<void | false> {
    const events = await findEligibleEvents(this.db);
    if (events.length === 0) return false;

    const now = Date.now();
    const eligible: EligibleEvent[] = [];
    const graceSkippedIds: number[] = [];
    for (const e of events) {
      if (isWithinGracePeriod(e, now)) {
        graceSkippedIds.push(e.id);
      } else {
        eligible.push(e);
      }
    }
    if (graceSkippedIds.length > 0) {
      this.logger.debug(
        `Skipped ${graceSkippedIds.length} events in grace period: ${graceSkippedIds.join(', ')}`,
      );
    }
    if (eligible.length === 0) return false;

    this.logger.log(
      `Found ${eligible.length} eligible events for recruitment reminders`,
    );
    for (const event of eligible) {
      await this.processEvent(event);
    }
  }

  /** Process a single eligible event for bumps and DMs. */
  private async processEvent(event: EligibleEvent): Promise<void> {
    await this.maybeBumpChannel(event);
    const hoursUntilStart =
      (new Date(event.startTime).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilStart > 24) {
      this.logger.debug(
        `Event ${event.id} starts in ${hoursUntilStart.toFixed(1)}h — bump sent, DMs deferred`,
      );
      return;
    }
    await this.maybeSendDMs(event);
  }

  /** Post channel bump if not already done. */
  private async maybeBumpChannel(event: EligibleEvent): Promise<void> {
    const bumpKey = `recruitment-bump:event:${event.id}`;
    const alreadySent = await this.dedupService.checkAndMarkSent(
      bumpKey,
      DEDUP_TTL_SECONDS,
    );
    if (!alreadySent) {
      await this.postChannelBump(event);
    }
  }

  /** Send recruitment DMs if not already done. */
  private async maybeSendDMs(event: EligibleEvent): Promise<void> {
    const dmKey = `recruitment-dm:event:${event.id}`;
    const alreadySent = await this.dedupService.checkAndMarkSent(
      dmKey,
      DEDUP_TTL_SECONDS,
    );
    if (alreadySent) {
      this.logger.debug(
        `Recruitment DMs already sent for event ${event.id}, skipping`,
      );
      return;
    }
    let recipientIds = await findRecipients(
      this.db,
      event.gameId,
      event.creatorId,
      event.id,
    );
    recipientIds = await this.filterAbsentUsers(recipientIds, event);
    if (recipientIds.length > 0) {
      await this.sendRecruitmentDMs(event, recipientIds);
    } else {
      this.logger.debug(
        `No recruitment reminder recipients for event ${event.id}`,
      );
    }
  }

  /** Filter out users with active absences covering the event date. */
  private async filterAbsentUsers(
    recipientIds: number[],
    event: EligibleEvent,
  ): Promise<number[]> {
    if (recipientIds.length === 0) return recipientIds;
    const absentUserIds = await findAbsentUsers(
      this.db,
      recipientIds,
      event.startTime,
    );
    if (absentUserIds.size > 0) {
      this.logger.debug(
        `Excluded ${absentUserIds.size} absent users from recruitment reminder for event ${event.id}`,
      );
      return recipientIds.filter((id) => !absentUserIds.has(id));
    }
    return recipientIds;
  }

  /** Resolve context needed for recruitment DMs. */
  private async resolveRecruitmentContext(event: EligibleEvent) {
    const [defaultTimezone, clientUrl, voiceChannelId] = await Promise.all([
      this.settingsService.getDefaultTimezone().then((tz) => tz ?? 'UTC'),
      this.settingsService.getClientUrl(),
      this.notificationService.resolveVoiceChannelForEvent(event.id),
    ]);
    const eventDate = new Date(event.startTime).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: defaultTimezone,
    });
    const signupSummary = buildSignupSummary(event);
    return { clientUrl, voiceChannelId, eventDate, signupSummary };
  }

  /** Send recruitment reminder DMs to all eligible recipients. */
  private async sendRecruitmentDMs(
    event: EligibleEvent,
    recipientIds: number[],
  ): Promise<void> {
    const { clientUrl, voiceChannelId, eventDate, signupSummary } =
      await this.resolveRecruitmentContext(event);
    const message = `Spots available for ${event.gameName}: ${event.title} on ${eventDate}. ${signupSummary} — sign up now!`;
    const payload = this.buildRecruitmentPayload(
      event,
      signupSummary,
      clientUrl,
      voiceChannelId,
    );
    const results = await Promise.allSettled(
      recipientIds.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'recruitment_reminder',
          title: `Spots Available — ${event.title}`,
          message,
          payload,
        }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    this.logger.log(
      `Recruitment reminders for event ${event.id}: ${succeeded} sent, ${failed} failed (${recipientIds.length} recipients)`,
    );
  }

  /** Build the recruitment notification payload. */
  private buildRecruitmentPayload(
    event: EligibleEvent,
    signupSummary: string,
    clientUrl: string,
    voiceChannelId: string | null,
  ): Record<string, unknown> {
    return {
      eventId: event.id,
      eventTitle: event.title,
      gameId: event.gameId,
      gameName: event.gameName,
      signupSummary,
      startTime: event.startTime,
      url: `${clientUrl}/events/${event.id}`,
      discordUrl: buildDiscordUrl(event),
      ...(voiceChannelId ? { voiceChannelId } : {}),
    };
  }

  /** Check whether a channel bump should be skipped for this event. */
  private shouldSkipBump(event: EligibleEvent): boolean {
    if (!this.discordBotClient.isConnected()) {
      this.logger.warn(
        `Bot not connected — skipping channel bump for event ${event.id}`,
      );
      return true;
    }
    if (
      event.maxAttendees !== null &&
      event.signupCount >= event.maxAttendees
    ) {
      this.logger.debug(
        `Event ${event.id} is now full — skipping channel bump`,
      );
      return true;
    }
    return false;
  }

  /** Post a bump message in the event's Discord channel. */
  private async postChannelBump(event: EligibleEvent): Promise<void> {
    if (this.shouldSkipBump(event)) return;
    try {
      const clientUrl = await this.settingsService.getClientUrl();
      const { embed, row } = this.buildBumpEmbed(event, clientUrl);
      const message = await this.discordBotClient.sendEmbed(
        event.channelId,
        embed,
        row,
      );
      await this.persistBumpMessageId(event, message.id);
      this.logger.log(
        `Posted recruitment bump for event ${event.id} in channel ${event.channelId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to post channel bump for event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /** Persist the bump message ID on the discord_event_messages record. */
  private async persistBumpMessageId(
    event: EligibleEvent,
    bumpMessageId: string,
  ): Promise<void> {
    await this.db
      .update(schema.discordEventMessages)
      .set({ bumpMessageId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.discordEventMessages.eventId, event.id),
          eq(schema.discordEventMessages.channelId, event.channelId),
        ),
      );
  }

  /** Build the bump embed and action row. */
  private buildBumpEmbed(
    event: EligibleEvent,
    clientUrl: string,
  ): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
    const signupSummary = buildSignupSummary(event);
    const embedUrl = buildDiscordUrl(event);
    const hoursUntil = Math.round(
      (new Date(event.startTime).getTime() - Date.now()) / (1000 * 60 * 60),
    );
    const timeLabel = hoursUntil <= 24 ? 'tomorrow' : `in ${hoursUntil}h`;

    const embed = new EmbedBuilder()
      .setTitle(`\uD83D\uDCE2 Spots still available — event ${timeLabel}!`)
      .setDescription(
        `**${event.title}** — ${event.gameName}\n${signupSummary}`,
      )
      .setColor(EMBED_COLORS.ANNOUNCEMENT)
      .setTimestamp(new Date(event.startTime));

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/events/${event.id}`),
      new ButtonBuilder()
        .setLabel('View in Discord')
        .setStyle(ButtonStyle.Link)
        .setURL(embedUrl),
    );
    return { embed, row };
  }
}
