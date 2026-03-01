import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { EmbedBuilder } from 'discord.js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { PugInviteService } from '../discord-bot/services/pug-invite.service';
import { SettingsService } from '../settings/settings.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

/**
 * Post-event PUG onboarding reminder service (ROK-403).
 *
 * Runs every 60 seconds, checking for events that ended ~15 minutes ago.
 * For each recently ended event, finds PUG participants who haven't completed
 * their Raid Ledger onboarding and sends a Discord DM reminder with a link
 * to the FTE wizard and optionally a server invite.
 */
@Injectable()
export class PostEventReminderService {
  private readonly logger = new Logger(PostEventReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly pugInviteService: PugInviteService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * Cron: runs every 60 seconds — checks for events that ended ~15 minutes ago
   * and sends onboarding reminders to qualifying PUG participants.
   */
  @Cron('5 */1 * * * *', {
    name: 'PostEventReminderService_handlePostEventReminders',
  })
  async handlePostEventReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'PostEventReminderService_handlePostEventReminders',
      async () => {
        if (!this.clientService.isConnected()) {
          return;
        }

        this.logger.debug('Running post-event PUG reminder check...');

        // Find qualifying PUG slots: events ended 14-16 minutes ago,
        // PUG status is accepted/claimed, user hasn't completed onboarding,
        // and no reminder has been sent yet.
        const qualifyingPugs = await this.db.execute<{
          pug_slot_id: string;
          event_id: number;
          event_title: string;
          discord_user_id: string | null;
          claimed_by_user_id: number | null;
          user_discord_id: string | null;
          username: string | null;
        }>(sql`
          SELECT
            ps.id AS pug_slot_id,
            ps.event_id,
            e.title AS event_title,
            ps.discord_user_id,
            ps.claimed_by_user_id,
            u.discord_id AS user_discord_id,
            u.username
          FROM pug_slots ps
          JOIN events e ON e.id = ps.event_id
          LEFT JOIN users u ON u.id = ps.claimed_by_user_id
          WHERE upper(e.duration) BETWEEN (now() - interval '16 minutes') AND (now() - interval '14 minutes')
            AND ps.status IN ('accepted', 'claimed')
            AND e.cancelled_at IS NULL
            AND (u.onboarding_completed_at IS NULL OR ps.claimed_by_user_id IS NULL)
            AND ps.id NOT IN (
              SELECT pug_slot_id FROM post_event_reminders_sent
            )
        `);

        if (qualifyingPugs.length === 0) {
          return;
        }

        this.logger.log(
          `Found ${qualifyingPugs.length} qualifying PUGs for post-event reminder`,
        );

        const clientUrl = await this.settingsService.getClientUrl();
        const branding = await this.settingsService.getBranding();
        const communityName = branding.communityName || 'Raid Ledger';

        for (const pug of qualifyingPugs) {
          await this.sendPostEventReminder(pug, clientUrl, communityName);
        }
      },
    );
  }

  /**
   * Send a post-event onboarding reminder DM to a single PUG.
   */
  private async sendPostEventReminder(
    pug: {
      pug_slot_id: string;
      event_id: number;
      event_title: string;
      discord_user_id: string | null;
      claimed_by_user_id: number | null;
      user_discord_id: string | null;
      username: string | null;
    },
    clientUrl: string | null,
    communityName: string,
  ): Promise<void> {
    // Determine the Discord ID to DM — prefer the linked user's ID,
    // fall back to the PUG slot's Discord user ID
    const discordId = pug.user_discord_id || pug.discord_user_id;
    if (!discordId) {
      this.logger.debug(
        'No Discord ID for PUG slot %s, skipping',
        pug.pug_slot_id,
      );
      return;
    }

    // Skip users with local-only or unlinked Discord IDs
    if (discordId.startsWith('local:') || discordId.startsWith('unlinked:')) {
      return;
    }

    // Record that we're sending this reminder (idempotent via unique constraint)
    const trackResult = await this.db
      .insert(schema.postEventRemindersSent)
      .values({
        eventId: pug.event_id,
        pugSlotId: pug.pug_slot_id,
      })
      .onConflictDoNothing({
        target: [
          schema.postEventRemindersSent.eventId,
          schema.postEventRemindersSent.pugSlotId,
        ],
      })
      .returning();

    if (trackResult.length === 0) {
      // Already sent
      return;
    }

    // Check if user is in the Discord server
    const isInServer = await this.clientService.isGuildMember(discordId);

    // Build DM content
    const displayName = pug.username || 'there';
    const onboardingUrl = clientUrl ? `${clientUrl}/onboarding?rerun=1` : null;

    const descriptionLines = [
      `Hey **${displayName}**! Thanks for joining **${pug.event_title}**`,
      '',
    ];

    if (onboardingUrl) {
      descriptionLines.push(
        "Finish setting up your Raid Ledger profile so you're ready for the next one:",
        `[Complete your setup](${onboardingUrl})`,
      );
    }

    // Add Discord server invite if not already in server
    if (!isInServer) {
      const inviteUrl = await this.pugInviteService.generateServerInvite(
        pug.event_id,
      );
      if (inviteUrl) {
        descriptionLines.push(
          '',
          `Join the **${communityName}** Discord to stay in the loop:`,
          inviteUrl,
        );
      }
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.PUG_INVITE)
      .setTitle('Thanks for joining!')
      .setDescription(descriptionLines.join('\n'))
      .setFooter({ text: communityName })
      .setTimestamp();

    try {
      await this.clientService.sendEmbedDM(discordId, embed);
      this.logger.log(
        'Sent post-event reminder to %s for event %d (slot: %s)',
        discordId,
        pug.event_id,
        pug.pug_slot_id,
      );
    } catch (error) {
      this.logger.warn(
        'Failed to send post-event reminder to %s: %s',
        discordId,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
