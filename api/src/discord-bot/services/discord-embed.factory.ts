import { Injectable } from '@nestjs/common';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  EMBED_COLORS,
  EMBED_STATES,
  type EmbedState,
  SIGNUP_BUTTON_IDS,
} from '../discord-bot.constants';

/**
 * Minimal event data needed to build an embed.
 * Avoids coupling to the full EventResponseDto.
 */
export interface EmbedEventData {
  id: number;
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  signupCount: number;
  maxAttendees?: number | null;
  slotConfig?: {
    type?: string;
    tank?: number;
    healer?: number;
    dps?: number;
    flex?: number;
    player?: number;
    bench?: number;
  } | null;
  /** Actual per-role signup counts from roster_assignments */
  roleCounts?: Record<string, number> | null;
  /** Discord IDs of signed-up users, grouped by role for mention display */
  signupMentions?: Array<{ discordId: string; role: string | null }> | null;
  game?: {
    name: string;
    coverUrl?: string | null;
  } | null;
}

export interface EmbedContext {
  communityName?: string | null;
  clientUrl?: string | null;
}

/**
 * Factory service that constructs Discord.js EmbedBuilder instances
 * for each message type. Follows the universal embed anatomy from
 * the design spec section 2.2.
 *
 * Reusable by ROK-126 (reminders), ROK-180 (notifications),
 * ROK-292 (PUG invites), and other stories.
 */
@Injectable()
export class DiscordEmbedFactory {
  /**
   * Build an event announcement embed (Cyan accent).
   * Used when a new event is created and posted to Discord.
   * Includes signup action buttons (ROK-137).
   */
  buildEventAnnouncement(
    event: EmbedEventData,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const color = this.getColorForState(EMBED_STATES.POSTED);
    const embed = this.createBaseEmbed(event, context, color);
    const row = this.buildSignupButtons(event.id, context.clientUrl);
    return { embed, row };
  }

  /**
   * Build a cancelled event embed (Red accent, strikethrough title).
   * Used when an event is cancelled on the web.
   */
  buildEventCancelled(
    event: EmbedEventData,
    context: EmbedContext,
  ): { embed: EmbedBuilder } {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ERROR)
      .setTitle(`~~${event.title}~~ — CANCELLED`)
      .setDescription('This event has been cancelled.')
      .setFooter({
        text: `${context.communityName || 'Raid Ledger'}`,
      })
      .setTimestamp();

    return { embed };
  }

  /**
   * Re-render an existing embed with updated state.
   * Used by the state machine when embed_state transitions occur.
   */
  buildEventUpdate(
    event: EmbedEventData,
    context: EmbedContext,
    state: EmbedState,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const color = this.getColorForState(state);
    const embed = this.createBaseEmbed(event, context, color);
    // Cancelled and completed states don't show buttons
    if (state === EMBED_STATES.CANCELLED || state === EMBED_STATES.COMPLETED) {
      return { embed };
    }
    const row = this.buildSignupButtons(event.id, context.clientUrl);
    return { embed, row };
  }

  /**
   * Get the accent color for a given embed state.
   */
  private getColorForState(state: EmbedState): number {
    switch (state) {
      case EMBED_STATES.POSTED:
      case EMBED_STATES.FILLING:
      case EMBED_STATES.FULL:
        return EMBED_COLORS.ANNOUNCEMENT;
      case EMBED_STATES.IMMINENT:
        return EMBED_COLORS.REMINDER;
      case EMBED_STATES.LIVE:
        return EMBED_COLORS.SIGNUP_CONFIRMATION;
      case EMBED_STATES.COMPLETED:
        return EMBED_COLORS.SYSTEM;
      case EMBED_STATES.CANCELLED:
        return EMBED_COLORS.ERROR;
      default:
        return EMBED_COLORS.ANNOUNCEMENT;
    }
  }

  /**
   * Create the base embed following the universal anatomy.
   */
  private createBaseEmbed(
    event: EmbedEventData,
    context: EmbedContext,
    color: number,
  ): EmbedBuilder {
    const startDate = new Date(event.startTime);
    const endDate = new Date(event.endTime);
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
    const durationMinutes = Math.floor(
      (durationMs % (1000 * 60 * 60)) / (1000 * 60),
    );
    const durationStr =
      durationHours > 0
        ? durationMinutes > 0
          ? `${durationHours}h ${durationMinutes}m`
          : `${durationHours}h`
        : `${durationMinutes}m`;

    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'Raid Ledger' })
      .setTitle(`📅 ${event.title}`)
      .setColor(color);

    // Body: key data with bold labels
    const bodyLines: string[] = [];
    if (event.game?.name) {
      bodyLines.push(`🎮 **${event.game.name}**`);
    }
    bodyLines.push(`📆 **${dateStr}**  ⏰ **${timeStr}** (${durationStr})`);

    // Roster breakdown
    const rosterLine = this.buildRosterLine(event);
    if (rosterLine) {
      bodyLines.push('');
      bodyLines.push(rosterLine);
    }

    embed.setDescription(bodyLines.join('\n'));

    // Thumbnail: game art
    if (event.game?.coverUrl) {
      embed.setThumbnail(event.game.coverUrl);
    }

    // Footer
    embed.setFooter({
      text: `🔗 View in Raid Ledger • ${context.communityName || 'Community'}`,
    });

    embed.setTimestamp();

    return embed;
  }

  /**
   * Build the roster breakdown line for the embed.
   */
  private buildRosterLine(event: EmbedEventData): string | null {
    const slotConfig = event.slotConfig;
    const mentions = event.signupMentions ?? [];

    if (slotConfig && slotConfig.type === 'mmo') {
      const tankMax = slotConfig.tank ?? 0;
      const healerMax = slotConfig.healer ?? 0;
      const dpsMax = slotConfig.dps ?? 0;
      const totalMax = tankMax + healerMax + dpsMax + (slotConfig.flex ?? 0);

      const rc = event.roleCounts ?? {};
      const lines: string[] = [];
      lines.push(`── ROSTER: ${event.signupCount}/${totalMax} ──`);

      if (tankMax > 0) {
        const roleMentions = this.getMentionsForRole(mentions, 'tank');
        lines.push(`🛡️ Tanks (${rc['tank'] ?? 0}/${tankMax}): ${roleMentions || '—'}`);
      }
      if (healerMax > 0) {
        const roleMentions = this.getMentionsForRole(mentions, 'healer');
        lines.push(`💚 Healers (${rc['healer'] ?? 0}/${healerMax}): ${roleMentions || '—'}`);
      }
      if (dpsMax > 0) {
        const roleMentions = this.getMentionsForRole(mentions, 'dps');
        lines.push(`⚔️ DPS (${rc['dps'] ?? 0}/${dpsMax}): ${roleMentions || '—'}`);
      }

      return lines.join('\n');
    }

    if (event.maxAttendees) {
      const allMentions = this.getMentionsForRole(mentions, null);
      if (allMentions) {
        return `── ROSTER: ${event.signupCount}/${event.maxAttendees} ──\n${allMentions}`;
      }
      return `── ROSTER: ${event.signupCount}/${event.maxAttendees} ──`;
    }

    if (event.signupCount > 0) {
      const allMentions = this.getMentionsForRole(mentions, null);
      if (allMentions) {
        return `── ROSTER: ${event.signupCount} signed up ──\n${allMentions}`;
      }
      return `── ROSTER: ${event.signupCount} signed up ──`;
    }

    return null;
  }

  /**
   * Format Discord mentions for a specific role (or all if role is null).
   */
  private getMentionsForRole(
    mentions: Array<{ discordId: string; role: string | null }>,
    role: string | null,
  ): string {
    const filtered = role !== null
      ? mentions.filter((m) => m.role === role)
      : mentions;
    return filtered.map((m) => `<@${m.discordId}>`).join(' ');
  }

  /**
   * Build signup action buttons for the embed (ROK-137).
   * Includes: Sign Up (green), Tentative (yellow), Decline (red), View Event (link).
   */
  private buildSignupButtons(
    eventId: number,
    clientUrl?: string | null,
  ): ActionRowBuilder<ButtonBuilder> {
    const signupButton = new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`)
      .setLabel('Sign Up')
      .setStyle(ButtonStyle.Success);

    const tentativeButton = new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.TENTATIVE}:${eventId}`)
      .setLabel('Tentative')
      .setStyle(ButtonStyle.Secondary);

    const declineButton = new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.DECLINE}:${eventId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      signupButton,
      tentativeButton,
      declineButton,
    );

    // Add View Event link button if client URL is available
    const baseUrl = clientUrl || process.env.CLIENT_URL;
    if (baseUrl) {
      const viewButton = new ButtonBuilder()
        .setLabel('View Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${baseUrl}/events/${eventId}`);
      row.addComponents(viewButton);
    }

    return row;
  }
}
