import { absoluteEmbedImageUrl } from './embed-thumbnail.helpers';
import { Injectable } from '@nestjs/common';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { buildSignupButtons } from './discord-embed-buttons.helpers';
import { DiscordEmojiService } from './discord-emoji.service';
import { buildRosterLine, buildViewButton } from './discord-embed.helpers';
import { createInviteEmbed } from './discord-embed-invite.helpers';
import {
  authorLineFor,
  gameDetailUrl,
  lifecycleToChromeState,
} from './discord-embed-event-chrome.helpers';
import { buildEventBody } from './discord-embed-event-body.helpers';
import type { SchedulingPollEmbedData } from './discord-embed-scheduling.types';
import {
  buildSchedulingPollEmbedBody,
  buildSchedulingPollButton,
} from './discord-embed-scheduling.helpers';
import { buildPushContentForState } from './discord-embed-state.helpers';

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
    /** ROK-1460: the roster renders names, and prefers this one. */
    displayName?: string | null;
    role: string | null;
    preferredRoles: string[] | null;
    status?: string | null;
    className?: string | null;
    runningLate?: boolean | null;
  }> | null;
  // ─── ROK-1460 widening seam ───────────────────────────────
  // `game` is the ONE place the event projection grows. ROK-1447 adds its
  // Quick Play badge inputs (price / co-op) here too; keep new fields optional
  // so the five hydration sites can adopt them one at a time.
  game?: {
    /** Hydrated so the title can link to the game detail page (ROK-1460). */
    id?: number | null;
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
  'signup' | 'view' | 'none' | ActionRowBuilder<ButtonBuilder>;

export interface BuildEventEmbedOptions {
  state?: EmbedState;
  buttons?: EmbedButtonMode;
  /** ROK-1446: a multi-group message carries no per-event button row. */
  multiGroup?: boolean;
  /** RESCHEDULING only — links the open scheduling poll when known. */
  pollUrl?: string | null;
}

/** Standard return type for all embed factory methods. */
export interface EmbedResult {
  embed: EmbedBuilder;
  row?: ActionRowBuilder<ButtonBuilder>;
  content?: string;
}

/** States that no longer invite anyone to act. */
const TERMINAL_STATES: readonly EmbedState[] = [
  EMBED_STATES.CANCELLED,
  EMBED_STATES.COMPLETED,
  EMBED_STATES.RESCHEDULING,
];

/**
 * Factory service that constructs Discord.js EmbedBuilder instances.
 */
@Injectable()
export class DiscordEmbedFactory {
  constructor(private readonly emojiService: DiscordEmojiService) {}

  /**
   * Build a scheduled-event embed for the channel surface.
   *
   * @param event - The event being rendered.
   * @param context - Community name, client URL and timezone.
   * @param options - Lifecycle state, button mode, multi-group flag, poll URL.
   * @returns The chromed embed, its button row (when any) and the push line.
   */
  buildEventEmbed(
    event: EmbedEventData,
    context: EmbedContext,
    options?: BuildEventEmbedOptions,
  ): EmbedResult {
    const state = options?.state ?? EMBED_STATES.POSTED;
    const embed = this.createChannelEventEmbed(event, context, options);
    const content = buildPushContentForState(event, state, context.timezone);
    if (options?.multiGroup || TERMINAL_STATES.includes(state)) {
      return { embed, content };
    }
    const base = this.attachButtons(
      embed,
      event.id,
      resolveClientUrl(context),
      options?.buttons ?? 'signup',
    );
    return { ...base, content };
  }

  /** Build a cancelled event embed — the CANCELLED row of the grammar table. */
  buildEventCancelled(
    event: EmbedEventData,
    context: EmbedContext,
  ): EmbedResult {
    return this.buildEventEmbed(event, context, {
      state: EMBED_STATES.CANCELLED,
    });
  }

  /** Build an event invite DM embed (ROK-380). */
  buildEventInvite(
    event: EmbedEventData,
    context: EmbedContext,
    inviterUsername: string,
  ): EmbedResult {
    const embed = createInviteEmbed(event, context, inviterUsername);
    const row = buildViewButton(event.id, context.clientUrl);
    return row ? { embed, row } : { embed };
  }

  /** @deprecated Use buildEventEmbed() */
  buildEventUpdate(
    event: EmbedEventData,
    context: EmbedContext,
    state: EmbedState,
  ): EmbedResult {
    return this.buildEventEmbed(event, context, { state, buttons: 'signup' });
  }

  /** Build a rescheduling embed (amber, poll open, ROK-1034 / ROK-1370). */
  buildEventRescheduling(
    event: EmbedEventData,
    context: EmbedContext,
    pollUrl?: string | null,
  ): EmbedResult {
    return this.buildEventEmbed(event, context, {
      state: EMBED_STATES.RESCHEDULING,
      pollUrl,
    });
  }

  /** Build a scheduling poll embed for a Discord channel (ROK-1014). */
  buildSchedulingPollEmbed(
    data: SchedulingPollEmbedData,
    context: EmbedContext,
  ): EmbedResult {
    const embed = buildSchedulingPollEmbedBody(data, context);
    const row = buildSchedulingPollButton(data);
    return { embed, row };
  }

  // ─── Private helpers ──────────────────────────────────────

  /** Chrome + title + body + art for one lifecycle state. */
  private createChannelEventEmbed(
    event: EmbedEventData,
    context: EmbedContext,
    options?: BuildEventEmbedOptions,
  ): ChannelEmbed {
    const state = options?.state ?? EMBED_STATES.POSTED;
    const clientUrl = resolveClientUrl(context);
    const embed = createChannelEmbed({
      state: lifecycleToChromeState(state),
      communityName: context.communityName,
      authorLine: authorLineFor(state, event),
    });
    applyTitle(embed, event, state, clientUrl);
    const body = buildEventBody(event, {
      state,
      clientUrl,
      roster: buildRosterLine(event, this.emojiService),
      pollUrl: options?.pollUrl,
    });
    if (body) embed.setDescription(body);
    applyThumbnail(embed, event, state);
    return embed;
  }

  private attachButtons(
    embed: ChannelEmbed,
    eventId: number,
    clientUrl?: string | null,
    buttons?: EmbedButtonMode,
  ): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
    if (buttons === 'none') return { embed };
    if (buttons === 'signup')
      return { embed, row: buildSignupButtons(eventId, clientUrl) };
    if (buttons === 'view') {
      const row = buildViewButton(eventId, clientUrl);
      return row ? { embed, row } : { embed };
    }
    return { embed, row: buttons };
  }
}

/** Context URL first, then the deployment-wide fallback. */
function resolveClientUrl(context: EmbedContext): string | undefined {
  return context.clientUrl || process.env.CLIENT_URL;
}

/** Title text + the game-detail link, struck through once cancelled. */
function applyTitle(
  embed: ChannelEmbed,
  event: EmbedEventData,
  state: EmbedState,
  clientUrl?: string | null,
): void {
  if (state === EMBED_STATES.CANCELLED) {
    embed.setTitle(`~~${event.title}~~`);
    return;
  }
  embed.setTitle(event.title);
  if (state === EMBED_STATES.RESCHEDULING) return;
  const url = gameDetailUrl(clientUrl, event.game?.id);
  if (url) embed.setURL(url);
}

/** Cover art, except once the event is cancelled (spec AC4). */
function applyThumbnail(
  embed: ChannelEmbed,
  event: EmbedEventData,
  state: EmbedState,
): void {
  if (state === EMBED_STATES.CANCELLED) return;
  const thumbnail = absoluteEmbedImageUrl(event.game?.coverUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);
}
