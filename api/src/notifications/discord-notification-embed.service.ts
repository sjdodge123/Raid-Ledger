import { Injectable } from '@nestjs/common';
import {
  type EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { createDmEmbed } from '../discord-bot/embeds/embed-chrome.helpers';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { SettingsService } from '../settings/settings.service';
import {
  notificationEmbedState,
  getEmojiForType,
  getTypeLabel,
  addTypeSpecificFields,
  buildExtraRows,
  buildPrimaryButton,
  buildInlineButtons,
} from './notification-embed.helpers';

interface NotificationEmbedInput {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

interface EmbedResult {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
  rows?: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Builds Discord embed messages for each notification type (ROK-180 AC-3, AC-8).
 */
@Injectable()
export class DiscordNotificationEmbedService {
  constructor(private readonly settingsService: SettingsService) {}

  /** Build a notification embed with action buttons. */
  async buildNotificationEmbed(
    input: NotificationEmbedInput,
    communityName: string,
  ): Promise<EmbedResult> {
    const emoji = getEmojiForType(input.type);
    const categoryLabel = getTypeLabel(input.type);
    const embed = createDmEmbed({
      state: notificationEmbedState(input.type),
      communityName,
      footerLabel: categoryLabel,
      timestamp: false,
    })
      .setTitle(`${emoji} ${input.title}`)
      .setDescription(input.message)
      .setTimestamp(this.resolveTimestamp(input));
    addTypeSpecificFields(embed, input.type, input.payload);
    const clientUrl = await this.resolveClientUrl();
    const row = this.buildActionRow(input, clientUrl);
    const rows = buildExtraRows(input.type, input.payload, clientUrl);
    return { embed, row, rows };
  }

  /**
   * Build a welcome DM embed (AC-1).
   *
   * ROK-1477 A2: the `accentColor` branding override is GONE. Colour is chosen
   * by state (`announcing`) like every other embed; a community accent would be
   * a second colour axis, which is what this cycle deletes.
   */
  async buildWelcomeEmbed(communityName: string): Promise<EmbedResult> {
    const name = communityName || 'Raid Ledger';
    const clientUrl = await this.resolveClientUrl();
    const embed = this.buildWelcomeEmbedContent(name);
    const row = this.buildWelcomeActionRow(clientUrl);
    return { embed, row };
  }

  /** Build the welcome embed content with fields. */
  private buildWelcomeEmbedContent(name: string): EmbedBuilder {
    return createDmEmbed({ state: 'announcing', communityName: name })
      .setTitle(`Welcome to ${name}!`)
      .setDescription(
        `Hosted by **Raid Ledger** — your Discord account is now linked and you're officially part of the community! Here's what you can do:`,
      )
      .addFields(
        {
          name: 'Browse & sign up for events',
          value:
            'Check the calendar for upcoming raids and events. One click to join — your roster spot is reserved.',
        },
        {
          name: 'Stay in the loop',
          value:
            "You'll get DMs for event reminders, roster changes, and new events for games you follow. Customize what you receive anytime in your notification settings.",
        },
        {
          name: 'Set up your profile',
          value:
            'Add your characters, pick a display name, and choose an avatar to stand out on the roster.',
        },
      );
  }

  /** Build the welcome action row with navigation buttons. */
  private buildWelcomeActionRow(
    clientUrl: string,
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Events')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/events`),
      new ButtonBuilder()
        .setLabel('Set Up Profile')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/profile`),
      new ButtonBuilder()
        .setLabel('Notification Settings')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/profile/preferences/notifications`),
    );
  }

  /** Build embed for batched/summary notifications. */
  async buildBatchSummaryEmbed(
    type: NotificationType,
    count: number,
    communityName: string,
  ): Promise<EmbedResult> {
    const emoji = getEmojiForType(type);
    const typeLabel = getTypeLabel(type);
    const clientUrl = await this.resolveClientUrl();
    const embed = createDmEmbed({
      state: notificationEmbedState(type),
      communityName,
    })
      .setTitle(`${emoji} ${count} ${typeLabel} Notifications`)
      .setDescription(
        `You have ${count} new ${typeLabel.toLowerCase()} notifications. Check the web app for details.`,
      );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View All')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/profile/preferences/notifications`),
      new ButtonBuilder()
        .setLabel('Adjust Notifications')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/profile/preferences/notifications`),
    );
    return { embed, row };
  }

  /** Build embed for Discord unreachable in-app notification. */
  buildUnreachableNotificationMessage(): { title: string; message: string } {
    return {
      title: 'Discord DMs Unreachable',
      message:
        "We couldn't reach you on Discord — your DMs may be disabled or the bot may be blocked. Discord notifications have been paused. Check your DM settings and re-enable in your notification preferences.",
    };
  }

  /** Resolve the client URL from settings with fallback (ROK-408). */
  private async resolveClientUrl(): Promise<string> {
    return this.settingsService.getClientUrl();
  }

  /** Resolve the timestamp for the embed footer (ROK-545, ROK-760). */
  private resolveTimestamp(input: NotificationEmbedInput): Date {
    if (input.type === 'event_rescheduled' && input.payload?.newStartTime)
      return new Date(input.payload.newStartTime as string);
    const eventTypes: NotificationType[] = [
      'event_reminder',
      'new_event',
      'event_cancelled',
      'subscribed_game',
      'recruitment_reminder',
      'role_gap_alert',
    ];
    if (eventTypes.includes(input.type) && input.payload?.startTime)
      return new Date(input.payload.startTime as string);
    return new Date();
  }

  /** Build the main action row with primary + adjust buttons. */
  private buildActionRow(
    input: NotificationEmbedInput,
    clientUrl: string,
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons: ButtonBuilder[] = [];
    const primaryButton = buildPrimaryButton(
      input.type,
      input.notificationId,
      input.payload,
      clientUrl,
    );
    if (primaryButton) buttons.push(primaryButton);
    buttons.push(...buildInlineButtons(input.type, input.payload, clientUrl));
    const discordButton = this.buildDiscordLinkButton(input);
    if (discordButton) buttons.push(discordButton);
    buttons.push(
      new ButtonBuilder()
        .setLabel('Adjust Notifications')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/profile/preferences/notifications`),
    );
    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }

  /** Build an optional "View in Discord" button (ROK-504). */
  private buildDiscordLinkButton(
    input: NotificationEmbedInput,
  ): ButtonBuilder | null {
    const discordUrl = input.payload?.discordUrl;
    if (typeof discordUrl !== 'string' || !discordUrl) return null;
    return new ButtonBuilder()
      .setLabel('View in Discord')
      .setStyle(ButtonStyle.Link)
      .setURL(discordUrl);
  }
}
