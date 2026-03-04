import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

/** TTL for recruitment-reminder dedup keys: 48 hours in seconds */
const DEDUP_TTL_SECONDS = 48 * 60 * 60;

interface EligibleEvent {
  id: number;
  title: string;
  gameId: number;
  gameName: string;
  creatorId: number;
  startTime: string;
  maxAttendees: number | null;
  signupCount: number;
  channelId: string;
  guildId: string;
  messageId: string;
}

/**
 * Sends recruitment reminder DMs and bumps the embed ~24 hours before
 * an event that still has open spots (ROK-535).
 *
 * Own cron on a 15-minute cycle (staggered to second 45).
 * Recipients: users with game affinity (hearted or past attendees) who
 * have no signup record for the event, are not the creator, and don't
 * have an active absence.
 */
@Injectable()
export class RecruitmentReminderService {
  private readonly logger = new Logger(RecruitmentReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT)
    private redis: Redis,
    private readonly notificationService: NotificationService,
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
      async () => {
        await this.checkAndSendReminders();
      },
    );
  }

  async checkAndSendReminders(): Promise<void> {
    const events = await this.findEligibleEvents();
    if (events.length === 0) return;

    this.logger.log(
      `Found ${events.length} eligible events for recruitment reminders`,
    );

    for (const event of events) {
      const dedupKey = `recruitment-reminder:event:${event.id}`;
      const alreadySent = await this.redis.get(dedupKey);
      if (alreadySent) {
        this.logger.debug(
          `Recruitment reminder already sent for event ${event.id}, skipping`,
        );
        continue;
      }

      // Find recipients and send DMs
      let recipientIds = await this.findRecipients(
        event.gameId,
        event.creatorId,
        event.id,
      );

      if (recipientIds.length > 0) {
        // Exclude users with active absences covering the event date
        const absentUserIds = await this.findAbsentUsers(
          recipientIds,
          event.startTime,
        );
        if (absentUserIds.size > 0) {
          recipientIds = recipientIds.filter((id) => !absentUserIds.has(id));
          this.logger.debug(
            `Excluded ${absentUserIds.size} absent users from recruitment reminder for event ${event.id}`,
          );
        }
      }

      // Set dedup key before dispatching to prevent duplicates on retries
      await this.redis.set(dedupKey, '1', 'EX', DEDUP_TTL_SECONDS);

      // Send DMs to recipients
      if (recipientIds.length > 0) {
        await this.sendRecruitmentDMs(event, recipientIds);
      } else {
        this.logger.debug(
          `No recruitment reminder recipients for event ${event.id}`,
        );
      }

      // Post channel bump
      await this.postChannelBump(event);
    }
  }

  /**
   * Find future, non-cancelled events starting within [now, now + 24h]
   * that have a Discord embed, are NOT full, and have a game.
   */
  private async findEligibleEvents(): Promise<EligibleEvent[]> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const rows = await this.db.execute<{
      id: number;
      title: string;
      game_id: number;
      game_name: string;
      creator_id: number;
      start_time: string;
      max_attendees: number | null;
      signup_count: string;
      channel_id: string;
      guild_id: string;
      message_id: string;
    }>(sql`
      SELECT
        e.id,
        e.title,
        e.game_id,
        g.name AS game_name,
        e.creator_id,
        lower(e.duration)::text AS start_time,
        e.max_attendees,
        (
          SELECT count(*)
          FROM event_signups es
          WHERE es.event_id = e.id
            AND es.status NOT IN ('roached_out', 'departed', 'declined')
        )::text AS signup_count,
        dem.channel_id,
        dem.guild_id,
        dem.message_id
      FROM events e
      INNER JOIN games g ON g.id = e.game_id
      INNER JOIN discord_event_messages dem ON dem.event_id = e.id
      WHERE e.cancelled_at IS NULL
        AND lower(e.duration) >= ${now.toISOString()}::timestamptz
        AND lower(e.duration) <= ${in24h.toISOString()}::timestamptz
        AND dem.embed_state != 'full'
        AND e.game_id IS NOT NULL
    `);

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      gameId: r.game_id,
      gameName: r.game_name,
      creatorId: r.creator_id,
      startTime: r.start_time,
      maxAttendees: r.max_attendees,
      signupCount: parseInt(r.signup_count, 10),
      channelId: r.channel_id,
      guildId: r.guild_id,
      messageId: r.message_id,
    }));
  }

  /**
   * Find users with game affinity who have no signup record for this event.
   * Union of: hearted the game + signed up for past events of that game.
   * Excludes: event creator, users who already have ANY signup record.
   */
  private async findRecipients(
    gameId: number,
    creatorId: number,
    eventId: number,
  ): Promise<number[]> {
    const rows = await this.db.execute<{ id: number }>(sql`
      SELECT DISTINCT u.id FROM users u
      WHERE u.id != ${creatorId}
        AND (
          u.id IN (
            SELECT gi.user_id FROM game_interests gi WHERE gi.game_id = ${gameId}
          )
          OR
          u.id IN (
            SELECT es.user_id FROM event_signups es
            INNER JOIN events e ON e.id = es.event_id
            WHERE e.game_id = ${gameId}
              AND upper(e.duration) < NOW()::timestamp
              AND es.status = 'signed_up'
              AND e.cancelled_at IS NULL
              AND es.user_id IS NOT NULL
          )
        )
        AND u.id NOT IN (
          SELECT es.user_id FROM event_signups es
          WHERE es.event_id = ${eventId}
            AND es.user_id IS NOT NULL
        )
    `);

    return rows.map((r) => r.id);
  }

  /**
   * Find users from the candidate list who have an absence covering the event date.
   * Reuses the same pattern as GameAffinityNotificationService.
   */
  private async findAbsentUsers(
    userIds: number[],
    startTime: string,
  ): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();

    const eventDate = new Date(startTime).toISOString().split('T')[0];
    const rows = await this.db.execute<{ user_id: number }>(sql`
      SELECT DISTINCT a.user_id
      FROM game_time_absences a
      WHERE a.user_id = ANY(${userIds})
        AND ${eventDate} >= a.start_date
        AND ${eventDate} <= a.end_date
    `);

    return new Set(rows.map((r) => r.user_id));
  }

  /**
   * Send recruitment reminder DMs to all eligible recipients.
   */
  private async sendRecruitmentDMs(
    event: EligibleEvent,
    recipientIds: number[],
  ): Promise<void> {
    const defaultTimezone =
      (await this.settingsService.getDefaultTimezone()) ?? 'UTC';
    const clientUrl =
      (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173';

    const eventDate = new Date(event.startTime).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: defaultTimezone,
    });

    const signupSummary = event.maxAttendees
      ? `${event.signupCount}/${event.maxAttendees} spots filled`
      : `${event.signupCount} signed up`;

    const message = `Spots available for ${event.gameName}: ${event.title} on ${eventDate}. ${signupSummary} — sign up now!`;

    const discordUrl = `https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`;

    const voiceChannelId = await this.notificationService.resolveVoiceChannelId(
      event.gameId,
    );

    const results = await Promise.allSettled(
      recipientIds.map((userId) =>
        this.notificationService.create({
          userId,
          type: 'recruitment_reminder',
          title: `Spots Available — ${event.title}`,
          message,
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            gameId: event.gameId,
            gameName: event.gameName,
            signupSummary,
            startTime: event.startTime,
            url: `${clientUrl}/events/${event.id}`,
            discordUrl,
            ...(voiceChannelId ? { voiceChannelId } : {}),
          },
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    this.logger.log(
      `Recruitment reminders for event ${event.id}: ${succeeded} sent, ${failed} failed (${recipientIds.length} recipients)`,
    );
  }

  /**
   * Post a bump message in the event's Discord channel linking to the original embed.
   */
  private async postChannelBump(event: EligibleEvent): Promise<void> {
    if (!this.discordBotClient.isConnected()) {
      this.logger.warn(
        `Bot not connected — skipping channel bump for event ${event.id}`,
      );
      return;
    }

    try {
      const signupSummary = event.maxAttendees
        ? `${event.signupCount}/${event.maxAttendees} spots filled`
        : `${event.signupCount} signed up`;

      const embedUrl = `https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`;
      const clientUrl =
        (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173';

      const embed = new EmbedBuilder()
        .setTitle(`📢 Spots still available for tomorrow's event!`)
        .setDescription(
          `**${event.title}** — ${event.gameName}\n${signupSummary}\n\n[View original embed](${embedUrl})`,
        )
        .setColor(EMBED_COLORS.ANNOUNCEMENT)
        .setTimestamp(new Date(event.startTime));

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Sign Up')
          .setStyle(ButtonStyle.Link)
          .setURL(`${clientUrl}/events/${event.id}`),
      );

      await this.discordBotClient.sendEmbed(event.channelId, embed, row);

      this.logger.log(
        `Posted recruitment bump for event ${event.id} in channel ${event.channelId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to post channel bump for event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
