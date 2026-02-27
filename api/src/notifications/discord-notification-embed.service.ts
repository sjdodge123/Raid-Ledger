import { Injectable } from '@nestjs/common';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  EMBED_COLORS,
  ROACH_OUT_BUTTON_IDS,
} from '../discord-bot/discord-bot.constants';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { SettingsService } from '../settings/settings.service';

interface NotificationEmbedInput {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

/** Safely convert an unknown payload value to a string. */
function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}

interface EmbedResult {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
  /** Additional action rows (e.g., Roach Out button on reminders). */
  rows?: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Builds Discord embed messages for each notification type (ROK-180 AC-3, AC-8).
 * Uses color coding per type and includes action row buttons.
 */
@Injectable()
export class DiscordNotificationEmbedService {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Build a notification embed with action buttons.
   */
  async buildNotificationEmbed(
    input: NotificationEmbedInput,
    communityName: string,
  ): Promise<EmbedResult> {
    const color = this.getColorForType(input.type);
    const emoji = this.getEmojiForType(input.type);
    const categoryLabel = this.getTypeLabel(input.type);

    const embed = new EmbedBuilder()
      .setAuthor({ name: communityName || 'Raid Ledger' })
      .setTitle(`${emoji} ${input.title}`)
      .setDescription(input.message)
      .setColor(color)
      .setFooter({
        text: `${communityName || 'Raid Ledger'} \u00B7 ${categoryLabel}`,
      })
      .setTimestamp();

    // Add type-specific fields
    this.addTypeSpecificFields(embed, input);

    // Build action row with primary action + "Adjust Notifications" button
    const clientUrl = await this.resolveClientUrl();
    const row = this.buildActionRow(input, clientUrl);

    // ROK-378: Add Roach Out button row for event reminders
    const rows = this.buildExtraRows(input);

    return { embed, row, rows };
  }

  /**
   * Build a welcome DM embed (AC-1).
   */
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
        `Hosted by **Raid Ledger** — your Discord account is now linked and you're officially part of the community! ` +
          `Here's what you can do:`,
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
            "You'll get DMs for event reminders, roster changes, and new events for games you follow. " +
            'Customize what you receive anytime in your notification settings.',
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

  /**
   * Build embed for batched/summary notifications.
   */
  async buildBatchSummaryEmbed(
    type: NotificationType,
    count: number,
    communityName: string,
  ): Promise<EmbedResult> {
    const color = this.getColorForType(type);
    const emoji = this.getEmojiForType(type);
    const typeLabel = this.getTypeLabel(type);
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

  /**
   * Build embed for Discord unreachable in-app notification.
   */
  buildUnreachableNotificationMessage(): {
    title: string;
    message: string;
  } {
    return {
      title: 'Discord DMs Unreachable',
      message:
        "We couldn't reach you on Discord — your DMs may be disabled or the bot may be blocked. " +
        'Discord notifications have been paused. Check your DM settings and re-enable in your notification preferences.',
    };
  }

  /**
   * Build extra action rows for specific notification types (ROK-378).
   * Event reminders get a "Roach Out" interactive button.
   */
  private buildExtraRows(
    input: NotificationEmbedInput,
  ): ActionRowBuilder<ButtonBuilder>[] | undefined {
    if (input.type !== 'event_reminder') return undefined;

    const eventId = input.payload?.eventId;
    if (eventId == null) return undefined;

    const roachOutRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:${toStr(eventId)}`)
        .setLabel('Roach Out')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('\uD83E\uDEB3'),
    );

    return [roachOutRow];
  }

  private getColorForType(type: NotificationType): number {
    switch (type) {
      case 'event_reminder':
        return EMBED_COLORS.REMINDER;
      case 'new_event':
      case 'subscribed_game':
        return EMBED_COLORS.ANNOUNCEMENT;
      case 'slot_vacated':
      case 'bench_promoted':
      case 'roster_reassigned':
      case 'tentative_displaced':
        return EMBED_COLORS.ROSTER_UPDATE;
      case 'event_rescheduled':
        return EMBED_COLORS.REMINDER;
      case 'event_cancelled':
        return EMBED_COLORS.ERROR;
      case 'achievement_unlocked':
      case 'level_up':
        return EMBED_COLORS.SIGNUP_CONFIRMATION;
      case 'missed_event_nudge':
        return EMBED_COLORS.SYSTEM;
      default:
        return EMBED_COLORS.SYSTEM;
    }
  }

  private getEmojiForType(type: NotificationType): string {
    switch (type) {
      case 'event_reminder':
        return '⏰';
      case 'new_event':
        return '📅';
      case 'subscribed_game':
        return '🎮';
      case 'slot_vacated':
        return '🚪';
      case 'bench_promoted':
        return '🎉';
      case 'roster_reassigned':
        return '🔄';
      case 'tentative_displaced':
        return '⏳';
      case 'event_rescheduled':
        return '📆';
      case 'event_cancelled':
        return '❌';
      case 'achievement_unlocked':
        return '🏆';
      case 'level_up':
        return '⬆️';
      case 'missed_event_nudge':
        return '👋';
      default:
        return '🔔';
    }
  }

  private getTypeLabel(type: NotificationType): string {
    switch (type) {
      case 'event_reminder':
        return 'Event Reminder';
      case 'new_event':
        return 'New Event';
      case 'subscribed_game':
        return 'Game Activity';
      case 'slot_vacated':
        return 'Slot Vacated';
      case 'bench_promoted':
        return 'Bench Promoted';
      case 'roster_reassigned':
        return 'Roster Reassigned';
      case 'tentative_displaced':
        return 'Tentative Displaced';
      case 'event_rescheduled':
        return 'Event Rescheduled';
      case 'event_cancelled':
        return 'Event Cancelled';
      case 'achievement_unlocked':
        return 'Achievement';
      case 'level_up':
        return 'Level Up';
      case 'missed_event_nudge':
        return 'Missed Event';
      default:
        return 'Notification';
    }
  }

  private addTypeSpecificFields(
    embed: EmbedBuilder,
    input: NotificationEmbedInput,
  ): void {
    const payload = input.payload;
    if (!payload) return;

    switch (input.type) {
      case 'event_reminder':
        if (payload.eventTitle) {
          embed.addFields({
            name: 'Event',
            value: toStr(payload.eventTitle),
            inline: true,
          });
        }
        break;
      case 'new_event':
        if (payload.gameName) {
          embed.addFields({
            name: 'Game',
            value: toStr(payload.gameName),
            inline: true,
          });
        }
        break;
      case 'slot_vacated':
        if (payload.slotName) {
          embed.addFields({
            name: 'Slot',
            value: toStr(payload.slotName),
            inline: true,
          });
        }
        break;
      case 'event_cancelled':
        if (payload.eventTitle) {
          embed.addFields({
            name: 'Event',
            value: toStr(payload.eventTitle),
            inline: true,
          });
        }
        break;
      case 'roster_reassigned':
        if (payload.oldRole) {
          embed.addFields({
            name: 'Previous Role',
            value: toStr(payload.oldRole),
            inline: true,
          });
        }
        if (payload.newRole && payload.newRole !== 'player') {
          embed.addFields({
            name: 'New Role',
            value: toStr(payload.newRole),
            inline: true,
          });
        }
        break;
    }
  }

  /**
   * Resolve the client URL from settings with fallback (ROK-408).
   */
  private async resolveClientUrl(): Promise<string> {
    return (
      (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173'
    );
  }

  private buildActionRow(
    input: NotificationEmbedInput,
    clientUrl: string,
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons: ButtonBuilder[] = [];

    // Primary action button based on type
    const primaryButton = this.buildPrimaryButton(input, clientUrl);
    if (primaryButton) {
      buttons.push(primaryButton);
    }

    // ROK-504: "View in Discord" button when Discord channel link is available
    const discordButton = this.buildDiscordLinkButton(input);
    if (discordButton) {
      buttons.push(discordButton);
    }

    // "Adjust Notifications" button on every DM (AC-8)
    buttons.push(
      new ButtonBuilder()
        .setLabel('Adjust Notifications')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/profile/preferences/notifications`),
    );

    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }

  private buildPrimaryButton(
    input: NotificationEmbedInput,
    clientUrl: string,
  ): ButtonBuilder | null {
    const payload = input.payload;
    const eventId = payload?.eventId != null ? toStr(payload.eventId) : null;

    switch (input.type) {
      case 'event_reminder':
      case 'new_event':
      case 'subscribed_game':
      case 'event_rescheduled':
      case 'event_cancelled':
        if (eventId) {
          return new ButtonBuilder()
            .setLabel(input.type === 'new_event' ? 'Sign Up' : 'View Event')
            .setStyle(ButtonStyle.Link)
            .setURL(
              `${clientUrl}/events/${eventId}?notif=${input.notificationId}`,
            );
        }
        break;
      case 'slot_vacated':
      case 'bench_promoted':
      case 'roster_reassigned':
      case 'tentative_displaced':
        if (eventId) {
          return new ButtonBuilder()
            .setLabel('View Roster')
            .setStyle(ButtonStyle.Link)
            .setURL(
              `${clientUrl}/events/${eventId}?notif=${input.notificationId}`,
            );
        }
        break;
    }

    return null;
  }

  /**
   * ROK-504: Build an optional "View in Discord" button when the payload
   * contains a Discord channel URL.
   */
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
