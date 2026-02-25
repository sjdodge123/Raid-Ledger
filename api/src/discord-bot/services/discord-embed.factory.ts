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
import { DiscordEmojiService } from './discord-emoji.service';

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
  /** Signed-up users grouped by role for mention/name display */
  signupMentions?: Array<{
    discordId?: string | null;
    username?: string | null;
    role: string | null;
    preferredRoles: string[] | null;
    /** ROK-459: Signup attendance status */
    status?: string | null;
    /** ROK-465: WoW class name for class emoji in roster */
    className?: string | null;
  }> | null;
  game?: {
    name: string;
    coverUrl?: string | null;
  } | null;
}

export interface EmbedContext {
  communityName?: string | null;
  clientUrl?: string | null;
  /** IANA timezone for formatting event times (e.g., 'America/New_York'). Falls back to UTC. */
  timezone?: string | null;
}

/** Controls what action row buttons are attached to the embed. */
export type EmbedButtonMode =
  /** Signup buttons (Sign Up, Tentative, Decline) + View Event link */
  | 'signup'
  /** View Event link button only */
  | 'view'
  /** No buttons */
  | 'none'
  /** Caller provides a custom action row */
  | ActionRowBuilder<ButtonBuilder>;

export interface BuildEventEmbedOptions {
  /** Embed color state (default: POSTED) */
  state?: EmbedState;
  /** What buttons to attach (default: 'signup') */
  buttons?: EmbedButtonMode;
}

/**
 * Factory service that constructs Discord.js EmbedBuilder instances.
 * All event embeds use `buildEventEmbed()` for a consistent visual layout.
 */
@Injectable()
export class DiscordEmbedFactory {
  constructor(private readonly emojiService: DiscordEmojiService) {}

  /**
   * Build a standard event embed with consistent layout.
   * The embed body is always the same: title, game, date/time, full roster breakdown.
   * The `options` parameter controls color (via state) and what buttons are attached.
   */
  buildEventEmbed(
    event: EmbedEventData,
    context: EmbedContext,
    options?: BuildEventEmbedOptions,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const state = options?.state ?? EMBED_STATES.POSTED;
    const buttons = options?.buttons ?? 'signup';

    const color = this.getColorForState(state);
    const embed = this.createBaseEmbed(event, context, color);

    // Cancelled and completed states never show buttons regardless of request
    if (state === EMBED_STATES.CANCELLED || state === EMBED_STATES.COMPLETED) {
      return { embed };
    }

    if (buttons === 'none') {
      return { embed };
    }

    if (buttons === 'signup') {
      const row = this.buildSignupButtons(event.id, context.clientUrl);
      return { embed, row };
    }

    if (buttons === 'view') {
      const row = this.buildViewButton(event.id, context.clientUrl);
      return row ? { embed, row } : { embed };
    }

    // Custom ActionRowBuilder provided by caller
    return { embed, row: buttons };
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
   * Build an event invite DM embed (ROK-380).
   * Used by the /invite slash command to send a rich invite to a Discord user.
   * Intentionally different visual from channel embeds: personalized title,
   * inviter attribution in footer, teal PUG accent color.
   */
  buildEventInvite(
    event: EmbedEventData,
    context: EmbedContext,
    inviterUsername: string,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const startDate = new Date(event.startTime);
    const startUnix = Math.floor(startDate.getTime() / 1000);
    const timeDisplay = `<t:${startUnix}:f> (<t:${startUnix}:R>)`;

    const bodyLines: string[] = [];
    if (event.game?.name) {
      bodyLines.push(`🎮 **${event.game.name}**`);
    }
    bodyLines.push(`📆 ${timeDisplay}`);
    if (event.description) {
      const excerpt =
        event.description.length > 200
          ? event.description.slice(0, 200) + '...'
          : event.description;
      bodyLines.push('');
      bodyLines.push(excerpt);
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.PUG_INVITE)
      .setTitle(`You're invited to **${event.title}**!`)
      .setDescription(bodyLines.join('\n'))
      .setFooter({
        text: `Sent by ${inviterUsername} via ${context.communityName || 'Raid Ledger'}`,
      })
      .setTimestamp();

    // ROK-399: Make title clickable
    const clientUrl = context.clientUrl || process.env.CLIENT_URL;
    if (clientUrl) {
      embed.setURL(`${clientUrl}/events/${event.id}`);
    }

    if (event.game?.coverUrl) {
      embed.setThumbnail(event.game.coverUrl);
    }

    const row = this.buildViewButton(event.id, context.clientUrl);
    return row ? { embed, row } : { embed };
  }

  // ---- Deprecated aliases (kept for backward compatibility during migration) ----

  /** @deprecated Use buildEventEmbed() instead */
  buildEventAnnouncement(
    event: EmbedEventData,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    return this.buildEventEmbed(event, context, {
      state: EMBED_STATES.POSTED,
      buttons: 'signup',
    });
  }

  /** @deprecated Use buildEventEmbed() instead */
  buildEventUpdate(
    event: EmbedEventData,
    context: EmbedContext,
    state: EmbedState,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    return this.buildEventEmbed(event, context, {
      state,
      buttons: 'signup',
    });
  }

  // ---- Private helpers ----

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
   * Always renders: title, game, date/time with duration, full roster breakdown.
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

    const startUnix = Math.floor(startDate.getTime() / 1000);
    const timeDisplay = `<t:${startUnix}:f> (<t:${startUnix}:R>)`;

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'Raid Ledger' })
      .setTitle(`📅 ${event.title}`)
      .setColor(color);

    // ROK-399: Make title clickable by linking to event page
    const clientUrl = context.clientUrl || process.env.CLIENT_URL;
    if (clientUrl) {
      embed.setURL(`${clientUrl}/events/${event.id}`);
    }

    // Body: key data with bold labels
    const bodyLines: string[] = [];
    if (event.game?.name) {
      bodyLines.push(`🎮 **${event.game.name}**`);
    }
    bodyLines.push(`📆 ${timeDisplay} (${durationStr})`);

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

    // Footer — ROK-399: community name only (title is now the clickable link)
    embed.setFooter({
      text: context.communityName || 'Raid Ledger',
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

      const roleSections: Array<{
        emoji: string;
        label: string;
        count: number;
        max: number;
        role: string;
      }> = [];
      if (tankMax > 0)
        roleSections.push({
          emoji: this.emojiService.getRoleEmoji('tank'),
          label: 'Tanks',
          count: rc['tank'] ?? 0,
          max: tankMax,
          role: 'tank',
        });
      if (healerMax > 0)
        roleSections.push({
          emoji: this.emojiService.getRoleEmoji('healer'),
          label: 'Healers',
          count: rc['healer'] ?? 0,
          max: healerMax,
          role: 'healer',
        });
      if (dpsMax > 0)
        roleSections.push({
          emoji: this.emojiService.getRoleEmoji('dps'),
          label: 'DPS',
          count: rc['dps'] ?? 0,
          max: dpsMax,
          role: 'dps',
        });

      roleSections.forEach((section, idx) => {
        if (idx > 0) lines.push('');
        lines.push(
          `${section.emoji} **${section.label}** (${section.count}/${section.max}):`,
        );
        const playerLines = this.getMentionsForRole(mentions, section.role);
        lines.push(playerLines || '\u2003—');
      });

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

  /** Max number of individual mentions to display before truncating with "+ N more" */
  private static readonly MAX_MENTIONS = 25;

  /**
   * Format Discord mentions for a specific role (or all if role is null).
   * Layout: class icon before name, role preferences after name, indented
   * under the role header.
   */
  private getMentionsForRole(
    mentions: Array<{
      discordId?: string | null;
      username?: string | null;
      role: string | null;
      preferredRoles: string[] | null;
      status?: string | null;
      className?: string | null;
    }>,
    role: string | null,
  ): string {
    const filtered =
      role !== null ? mentions.filter((m) => m.role === role) : mentions;
    const overflow = filtered.length - DiscordEmbedFactory.MAX_MENTIONS;
    const displayed = filtered.slice(0, DiscordEmbedFactory.MAX_MENTIONS);
    const result = displayed
      .map((m) => {
        const label = m.discordId ? `<@${m.discordId}>` : (m.username ?? '???');
        // ROK-459: ⏳ prefix for tentative players
        const tentativePrefix = m.status === 'tentative' ? '⏳ ' : '';
        // Class emoji before the name
        const classEmoji = m.className
          ? this.emojiService.getClassEmoji(m.className)
          : '';
        // Role preferences after the name
        const prefs =
          m.preferredRoles && m.preferredRoles.length > 0
            ? m.preferredRoles
            : m.role
              ? [m.role]
              : [];
        const roleEmojis = prefs
          .map((r) => this.emojiService.getRoleEmoji(r))
          .filter(Boolean)
          .join('');
        const prefix = [tentativePrefix, classEmoji].filter(Boolean).join('');
        const suffix = roleEmojis ? ` ${roleEmojis}` : '';
        return `\u2003${prefix}${prefix ? ' ' : ''}${label}${suffix}`;
      })
      .join('\n');
    return overflow > 0 ? `${result}\n\u2003+ ${overflow} more` : result;
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

  // ================================================================
  // Ad-Hoc Event Embeds (ROK-293)
  // ================================================================

  /**
   * Build an embed for when an ad-hoc event spawns.
   */
  buildAdHocSpawnEmbed(
    event: { id: number; title: string; gameName?: string },
    participants: Array<{ discordUserId: string; discordUsername: string }>,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.LIVE_EVENT)
      .setTitle(`🎮 ${event.title}`)
      .setDescription(
        `An ad-hoc session has started!` +
          (event.gameName ? `\n**Game:** ${event.gameName}` : ''),
      )
      .addFields({
        name: '👥 Players',
        value:
          participants.map((p) => `<@${p.discordUserId}>`).join(', ') || 'None',
      })
      .setTimestamp()
      .setFooter({
        text: context.communityName ?? 'Raid Ledger',
      });

    const row = this.buildViewButton(event.id, context.clientUrl);
    return row ? { embed, row } : { embed };
  }

  /**
   * Build an updated embed for an ad-hoc event (player join/leave batched updates).
   */
  buildAdHocUpdateEmbed(
    event: { id: number; title: string; gameName?: string },
    participants: Array<{
      discordUserId: string;
      discordUsername: string;
      isActive: boolean;
    }>,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const active = participants.filter((p) => p.isActive);
    const left = participants.filter((p) => !p.isActive);

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.LIVE_EVENT)
      .setTitle(`🎮 ${event.title}`)
      .setDescription(
        `**Status:** LIVE` +
          (event.gameName ? `\n**Game:** ${event.gameName}` : ''),
      )
      .addFields({
        name: `👥 Active (${active.length})`,
        value: active.map((p) => `<@${p.discordUserId}>`).join(', ') || 'None',
      });

    if (left.length > 0) {
      embed.addFields({
        name: `📤 Left (${left.length})`,
        value: left.map((p) => `~~<@${p.discordUserId}>~~`).join(', '),
      });
    }

    embed.setTimestamp().setFooter({
      text: context.communityName ?? 'Raid Ledger',
    });

    const row = this.buildViewButton(event.id, context.clientUrl);
    return row ? { embed, row } : { embed };
  }

  /**
   * Build a final summary embed when an ad-hoc event completes.
   */
  buildAdHocCompletedEmbed(
    event: {
      id: number;
      title: string;
      gameName?: string;
      startTime: string;
      endTime: string;
    },
    participants: Array<{
      discordUserId: string;
      discordUsername: string;
      totalDurationSeconds: number | null;
    }>,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
    const durationStr =
      durationMin >= 60
        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
        : `${durationMin}m`;

    const rosterLines = participants.map((p) => {
      const dur = p.totalDurationSeconds
        ? ` (${Math.round(p.totalDurationSeconds / 60)}m)`
        : '';
      return `<@${p.discordUserId}>${dur}`;
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SYSTEM)
      .setTitle(`✅ ${event.title} — Completed`)
      .setDescription(
        `Session ended after **${durationStr}**` +
          (event.gameName ? `\n**Game:** ${event.gameName}` : ''),
      )
      .addFields({
        name: `👥 Participants (${participants.length})`,
        value: rosterLines.join('\n') || 'None',
      })
      .setTimestamp()
      .setFooter({
        text: context.communityName ?? 'Raid Ledger',
      });

    const row = this.buildViewButton(event.id, context.clientUrl);
    return row ? { embed, row } : { embed };
  }

  /**
   * Build a standalone "View Event" link button.
   */
  private buildViewButton(
    eventId: number,
    clientUrl?: string | null,
  ): ActionRowBuilder<ButtonBuilder> | undefined {
    const baseUrl = clientUrl || process.env.CLIENT_URL;
    if (!baseUrl) return undefined;

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${baseUrl}/events/${eventId}`),
    );
  }
}
