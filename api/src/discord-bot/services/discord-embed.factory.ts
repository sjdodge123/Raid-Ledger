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
import {
  buildRosterLine,
  buildViewButton,
  buildAdHocUpdateEmbed as buildAdHocUpdateEmbedHelper,
  buildAdHocCompletedEmbed as buildAdHocCompletedEmbedHelper,
} from './discord-embed.helpers';
import { createInviteEmbed } from './discord-embed-invite.helpers';
import { formatDurationMs } from '../utils/format-duration';

/** Minimal event data needed to build an embed. */
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
  roleCounts?: Record<string, number> | null;
  signupMentions?: Array<{
    discordId?: string | null;
    username?: string | null;
    role: string | null;
    preferredRoles: string[] | null;
    status?: string | null;
    className?: string | null;
  }> | null;
  game?: {
    name: string;
    coverUrl?: string | null;
  } | null;
  voiceChannelId?: string | null;
}

export interface EmbedContext {
  communityName?: string | null;
  clientUrl?: string | null;
  timezone?: string | null;
}

/** Controls what action row buttons are attached to the embed. */
export type EmbedButtonMode =
  | 'signup'
  | 'view'
  | 'none'
  | ActionRowBuilder<ButtonBuilder>;

export interface BuildEventEmbedOptions {
  state?: EmbedState;
  buttons?: EmbedButtonMode;
}

/**
 * Factory service that constructs Discord.js EmbedBuilder instances.
 */
@Injectable()
export class DiscordEmbedFactory {
  constructor(private readonly emojiService: DiscordEmojiService) {}

  /** Build a standard event embed with consistent layout. */
  buildEventEmbed(
    event: EmbedEventData,
    context: EmbedContext,
    options?: BuildEventEmbedOptions,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const state = options?.state ?? EMBED_STATES.POSTED;
    const buttons = options?.buttons ?? 'signup';

    const color = this.getColorForState(state);
    const embed = this.createBaseEmbed(event, context, color);

    if (state === EMBED_STATES.CANCELLED || state === EMBED_STATES.COMPLETED) {
      return { embed };
    }

    return this.attachButtons(embed, event.id, context.clientUrl, buttons);
  }

  /** Build a cancelled event embed. */
  buildEventCancelled(
    event: EmbedEventData,
    context: EmbedContext,
  ): { embed: EmbedBuilder } {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ERROR)
      .setTitle(`~~${event.title}~~ — CANCELLED`)
      .setDescription('This event has been cancelled.')
      .setFooter({ text: `${context.communityName || 'Raid Ledger'}` })
      .setTimestamp();
    return { embed };
  }

  /** Build an event invite DM embed (ROK-380). */
  buildEventInvite(
    event: EmbedEventData,
    context: EmbedContext,
    inviterUsername: string,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const embed = createInviteEmbed(event, context, inviterUsername);
    const row = buildViewButton(event.id, context.clientUrl);
    return row ? { embed, row } : { embed };
  }

  /** @deprecated Use buildEventEmbed() */
  buildEventAnnouncement(
    event: EmbedEventData,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    return this.buildEventEmbed(event, context, {
      state: EMBED_STATES.POSTED,
      buttons: 'signup',
    });
  }

  /** @deprecated Use buildEventEmbed() */
  buildEventUpdate(
    event: EmbedEventData,
    context: EmbedContext,
    state: EmbedState,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    return this.buildEventEmbed(event, context, { state, buttons: 'signup' });
  }

  /** Build an ad-hoc spawn embed. */
  buildAdHocSpawnEmbed(
    event: { id: number; title: string; gameName?: string },
    participants: Array<{
      discordUserId: string;
      discordUsername: string;
    }>,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.LIVE_EVENT)
      .setTitle(`\uD83C\uDFAE ${event.title}`)
      .setDescription(
        `An ad-hoc session has started!` +
          (event.gameName ? `\n**Game:** ${event.gameName}` : ''),
      )
      .addFields({
        name: '\uD83D\uDC65 Players',
        value:
          participants.map((p) => `<@${p.discordUserId}>`).join(', ') || 'None',
      })
      .setTimestamp()
      .setFooter({ text: context.communityName ?? 'Raid Ledger' });

    const row = buildViewButton(event.id, context.clientUrl);
    return row ? { embed, row } : { embed };
  }

  /** Build an ad-hoc update embed. */
  buildAdHocUpdateEmbed(
    event: { id: number; title: string; gameName?: string },
    participants: Array<{
      discordUserId: string;
      discordUsername: string;
      isActive: boolean;
    }>,
    context: EmbedContext,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    return buildAdHocUpdateEmbedHelper(event, participants, context);
  }

  /** Build an ad-hoc completed embed. */
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
    return buildAdHocCompletedEmbedHelper(event, participants, context);
  }

  // ─── Private helpers ──────────────────────────────────────

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

  private createBaseEmbed(
    event: EmbedEventData,
    context: EmbedContext,
    color: number,
  ): EmbedBuilder {
    const { timeDisplay, durationStr } = this.formatTiming(event);

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'Raid Ledger' })
      .setTitle(`\uD83D\uDCC5 ${event.title}`)
      .setColor(color);

    const clientUrl = context.clientUrl || process.env.CLIENT_URL;
    if (clientUrl) embed.setURL(`${clientUrl}/events/${event.id}`);

    const bodyLines = this.buildBodyLines(event, timeDisplay, durationStr);

    const roster = buildRosterLine(event, this.emojiService);
    if (roster) {
      bodyLines.push('');
      bodyLines.push(roster);
    }

    embed.setDescription(bodyLines.join('\n'));
    if (event.game?.coverUrl) embed.setThumbnail(event.game.coverUrl);
    embed.setFooter({ text: context.communityName || 'Raid Ledger' });
    embed.setTimestamp();

    return embed;
  }

  private formatTiming(event: EmbedEventData): {
    timeDisplay: string;
    durationStr: string;
  } {
    const startDate = new Date(event.startTime);
    const endDate = new Date(event.endTime);
    const durationStr = formatDurationMs(
      endDate.getTime() - startDate.getTime(),
    );
    const startUnix = Math.floor(startDate.getTime() / 1000);
    const timeDisplay = `<t:${startUnix}:f> (<t:${startUnix}:R>)`;
    return { timeDisplay, durationStr };
  }

  private buildBodyLines(
    event: EmbedEventData,
    timeDisplay: string,
    durationStr: string,
  ): string[] {
    const lines: string[] = [];
    if (event.game?.name) lines.push(`\uD83C\uDFAE **${event.game.name}**`);
    lines.push(`\uD83D\uDCC6 ${timeDisplay} (${durationStr})`);
    if (event.voiceChannelId) {
      lines.push(`\uD83D\uDD0A <#${event.voiceChannelId}>`);
    }
    return lines;
  }

  private attachButtons(
    embed: EmbedBuilder,
    eventId: number,
    clientUrl?: string | null,
    buttons?: EmbedButtonMode,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    if (buttons === 'none') return { embed };

    if (buttons === 'signup') {
      const row = this.buildSignupButtons(eventId, clientUrl);
      return { embed, row };
    }

    if (buttons === 'view') {
      const row = buildViewButton(eventId, clientUrl);
      return row ? { embed, row } : { embed };
    }

    // Custom ActionRowBuilder
    return { embed, row: buttons };
  }

  private buildSignupButtons(
    eventId: number,
    clientUrl?: string | null,
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`)
        .setLabel('Sign Up')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${SIGNUP_BUTTON_IDS.TENTATIVE}:${eventId}`)
        .setLabel('Tentative')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${SIGNUP_BUTTON_IDS.DECLINE}:${eventId}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    );

    const baseUrl = clientUrl || process.env.CLIENT_URL;
    if (baseUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel('View Event')
          .setStyle(ButtonStyle.Link)
          .setURL(`${baseUrl}/events/${eventId}`),
      );
    }

    return row;
  }
}
