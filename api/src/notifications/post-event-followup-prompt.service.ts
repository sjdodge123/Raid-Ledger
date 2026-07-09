import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import {
  EMBED_COLORS,
  POST_EVENT_FOLLOWUP_BUTTON_IDS,
} from '../discord-bot/discord-bot.constants';
import type { FollowupCandidateEvent } from './post-event-followup.helpers';

/** Organizer gate row: Discord link + moderation state + opt-out flag. */
type OrganizerGate = {
  discord_id: string | null;
  deactivated_at: Date | null;
  banned_at: Date | null;
  kicked_at: Date | null;
  discord_enabled: boolean;
};

/**
 * Sends the "Schedule a follow-up?" organizer prompt DM (ROK-1371 M3). This is a
 * direct DM with bespoke buttons, so it does NOT route through `createMany` and
 * must gate the organizer manually — the `dispatchMany` deactivation/opt-out
 * filters do not apply here.
 */
@Injectable()
export class PostEventFollowupPromptService {
  private readonly logger = new Logger(PostEventFollowupPromptService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
  ) {}

  /** DM the organizer a follow-up prompt for a just-ended event. */
  async sendOrganizerPrompt(event: FollowupCandidateEvent): Promise<void> {
    const gate = await this.loadOrganizerGate(event.creator_id);
    if (!this.isReachable(gate)) return;
    const embed = this.buildEmbed(event);
    const row = this.buildRow(event);
    try {
      await this.clientService.sendEmbedDM(gate!.discord_id!, embed, row);
    } catch (error) {
      this.logger.warn(
        'Failed to send follow-up prompt for event %d: %s',
        event.id,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /** Load the organizer's Discord link, moderation state, and opt-out flag. */
  private async loadOrganizerGate(
    creatorId: number,
  ): Promise<OrganizerGate | null> {
    const rows = await this.db.execute<OrganizerGate>(sql`
      SELECT u.discord_id, u.deactivated_at, u.banned_at, u.kicked_at,
        COALESCE(
          (p.channel_prefs #>> '{post_event_followup,discord}')::boolean, true
        ) AS discord_enabled
      FROM users u
      LEFT JOIN user_notification_preferences p ON p.user_id = u.id
      WHERE u.id = ${creatorId}
      LIMIT 1
    `);
    return Array.from(rows)[0] ?? null;
  }

  /** True when the organizer is linked, active, and opted in. */
  private isReachable(gate: OrganizerGate | null): boolean {
    return (
      !!gate &&
      !!gate.discord_id &&
      !gate.deactivated_at &&
      !gate.banned_at &&
      !gate.kicked_at &&
      gate.discord_enabled
    );
  }

  /** Build the prompt embed. */
  private buildEmbed(event: FollowupCandidateEvent): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(EMBED_COLORS.ANNOUNCEMENT)
      .setTitle('Schedule a follow-up?')
      .setDescription(
        `**${event.title}** just wrapped. Want to line up the next one?`,
      )
      .setTimestamp();
  }

  /** Build the button row — poll button omitted when the event has no game. */
  private buildRow(
    event: FollowupCandidateEvent,
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${POST_EVENT_FOLLOWUP_BUTTON_IDS.SCHEDULE}:${event.id}`)
        .setLabel('Schedule event')
        .setStyle(ButtonStyle.Success),
    );
    if (event.game_id != null) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${POST_EVENT_FOLLOWUP_BUTTON_IDS.POLL}:${event.id}`)
          .setLabel('Start a poll')
          .setStyle(ButtonStyle.Primary),
      );
    }
    return row;
  }
}
