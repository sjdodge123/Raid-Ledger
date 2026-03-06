import { Injectable } from '@nestjs/common';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { SettingsService } from '../settings/settings.service';
import {
  getColorForType,
  getEmojiForType,
  getTypeLabel,
  addTypeSpecificFields,
  buildExtraRows,
  buildPrimaryButton,
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
    const color = getColorForType(input.type);
    const emoji = getEmojiForType(input.type);
    const categoryLabel = getTypeLabel(input.type);
    const embed = new EmbedBuilder()
      .setAuthor({ name: communityName || 'Raid Ledger' })
      .setTitle(`${emoji} ${input.title}`)
      .setDescription(input.message)
      .setColor(color)
      .setFooter({
        text: `${communityName || 'Raid Ledger'} \u00B7 ${categoryLabel}`,
      })
      .setTimestamp(this.resolveTimestamp(input));
    addTypeSpecificFields(embed, input.type, input.payload);
    const clientUrl = await this.resolveClientUrl();
    const row = this.buildActionRow(input, clientUrl);
    const rows = buildExtraRows(input.type, input.payload, clientUrl);
    return { embed, row, rows };
  }

  /** Build a welcome DM embed (AC-1). */
  async buildWelcomeEmbed(
    communityName: string,
    accentColor?: string | null,
  ): Promise<EmbedResult> {
    const color = accentColor
      ? parseInt(accentColor.replace('#', ''), 16)
      : EMBED_COLORS.ANNOUNCEMENT;
    const name = communityName || 'Raid Ledger';
    const clientUrl = await this.resolveClientUrl();
    const embed = new EmbedBuilder()
      .setAuthor({ name })
      .setTitle(`Welcome to ${name}!`)
      .setDescription(
        `Hosted by **Raid Ledger** — your Discord account is now linked and you're officially part of the community! Here's what you can do:`,
      )
      .setColor(color)
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
      )
      .setFooter({ text: name })
      .setTimestamp();
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
    return { embed, row };
  }

  /** Build embed for batched/summary notifications. */
  async buildBatchSummaryEmbed(
    type: NotificationType,
    count: number,
    communityName: string,
  ): Promise<EmbedResult> {
    const color = getColorForType(type);
    const emoji = getEmojiForType(type);
    const typeLabel = getTypeLabel(type);
    const clientUrl = await this.resolveClientUrl();
    const embed = new EmbedBuilder()
      .setAuthor({ name: communityName || 'Raid Ledger' })
      .setTitle(`${emoji} ${count} ${typeLabel} Notifications`)
      .setDescription(
        `You have ${count} new ${typeLabel.toLowerCase()} notifications. Check the web app for details.`,
      )
      .setColor(color)
      .setFooter({ text: communityName || 'Raid Ledger' })
      .setTimestamp();
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
    return (
      (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173'
    );
  }

  /** Resolve the timestamp for the embed footer (ROK-545). */
  private resolveTimestamp(input: NotificationEmbedInput): Date {
    const eventTypes: NotificationType[] = [
      'event_reminder',
      'new_event',
      'event_rescheduled',
      'event_cancelled',
      'subscribed_game',
      'recruitment_reminder',
      'role_gap_alert',
    ];
    if (eventTypes.includes(input.type) && input.payload?.startTime)
      return new Date(input.payload.startTime as string);
    if (input.type === 'event_rescheduled' && input.payload?.newStartTime)
      return new Date(input.payload.newStartTime as string);
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
