/**
 * DM body for a PLAYER-sent LFG invite (ROK-1455 D11).
 *
 * `lfg_player_invite` rides the ordinary notification pipeline, so the chrome
 * (colour, footer, the Adjust-Notifications row) comes from
 * `DiscordNotificationEmbedService`. This module owns what is specific to the
 * card: the `✉ Invited by …` author line, the "why you were suggested"
 * description, the masked group link, the decline button row, and at most
 * {@link LFG_PLAYER_INVITE_MAX_PERSONALIZED} reader-only fields.
 *
 * The personalized fields go through `addPersonalizedFields`, which accepts
 * ONLY a `DmEmbed` — so the "personalized field leaks into a channel" failure
 * the design warns about is a compile error, not a runtime one.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { LfgSuggestionReason } from '@raid-ledger/contract';
import { LFG_BUTTON_IDS } from '../discord-bot/discord-bot.constants';
import type { DmEmbed } from '../discord-bot/embeds/embed-chrome.helpers';
import {
  addPersonalizedFields,
  personalizedFieldName,
  type PersonalizedField,
} from '../discord-bot/embeds/embed-personalized.helpers';

/** Design cap (`design-embed-system:466`): "Keep it to two fields". */
export const LFG_PLAYER_INVITE_MAX_PERSONALIZED = 2;

/** The decline button's label (D12). */
export const LFG_INVITE_DECLINE_LABEL = 'Not interested';

/** Per-reason copy for the "why you" sentence (AC7). */
export const LFG_PLAYER_INVITE_REASON_COPY: Record<
  LfgSuggestionReason,
  string
> = {
  played: "you've played it with this community before",
  owns: "it's in your Steam library",
  hearted: 'you hearted it',
};

/** Everything the invite DM renders from. */
export interface LfgPlayerInviteDmInput {
  gameName: string;
  inviterName: string;
  reasons: LfgSuggestionReason[];
  /** Pre-built group link; null renders the DM without one. */
  url?: string | null;
  /** Steam lifetime playtime in MINUTES (`game_interests.playtime_forever`). */
  playtimeMinutes?: number | null;
}

/** The `✉ Invited by {name}` author line (AC7). */
export function lfgPlayerInviteAuthorLine(inviterName: string): string {
  return `✉ Invited by ${inviterName}`;
}

/** Ordered description lines: game, why, link (link omitted when absent). */
export function buildLfgPlayerInviteLines(
  input: LfgPlayerInviteDmInput,
): string[] {
  const why = input.reasons.map((r) => LFG_PLAYER_INVITE_REASON_COPY[r]);
  const lines = [
    `\u{1F3AE} **${input.gameName}**`,
    why.length > 0
      ? `You were suggested because ${why.join(', ')}.`
      : `${input.inviterName} thinks you'd be a good fit.`,
  ];
  if (input.url) lines.push(`[Join the group](${input.url})`);
  return lines;
}

/**
 * The reader-only fields, chosen `owned` → `hearted`, capped at
 * {@link LFG_PLAYER_INVITE_MAX_PERSONALIZED}. `owned` is omitted entirely when
 * playtime is unknown — never `0 hrs`. `playtime_forever` is minutes, so the
 * `/ 60` is load-bearing.
 */
export function pickLfgPlayerInviteFields(
  input: LfgPlayerInviteDmInput,
): PersonalizedField[] {
  const fields: PersonalizedField[] = [];
  const minutes = input.playtimeMinutes;
  if (typeof minutes === 'number' && Number.isFinite(minutes)) {
    fields.push({
      kind: 'owned',
      name: personalizedFieldName('owned'),
      value: `${Math.round(minutes / 60)} hrs played`,
      inline: true,
    });
  }
  if (input.reasons.includes('hearted')) {
    fields.push({
      kind: 'hearted',
      name: personalizedFieldName('hearted'),
      value: "You've marked this as a game you want to play",
      inline: true,
    });
  }
  return fields.slice(0, LFG_PLAYER_INVITE_MAX_PERSONALIZED);
}

/** Coerce a stored `notifications.payload` into the builder's input. */
export function readLfgPlayerInvitePayload(
  payload: Record<string, unknown>,
): LfgPlayerInviteDmInput {
  const known = new Set(Object.keys(LFG_PLAYER_INVITE_REASON_COPY));
  const reasons = (
    Array.isArray(payload.reasons) ? payload.reasons : []
  ).filter(
    (r): r is LfgSuggestionReason => typeof r === 'string' && known.has(r),
  );
  const minutes = payload.playtimeMinutes;
  return {
    gameName: typeof payload.gameName === 'string' ? payload.gameName : '',
    inviterName:
      typeof payload.inviterName === 'string'
        ? payload.inviterName
        : 'A player',
    reasons,
    url: typeof payload.url === 'string' ? payload.url : null,
    playtimeMinutes: typeof minutes === 'number' ? minutes : null,
  };
}

/**
 * Apply the invite card to an embed the notification pipeline chromed.
 *
 * @param embed - A DM embed (compile-time proof it never reaches a channel).
 * @param payload - Stored notification payload (`LfgPlayerInvitePayload`).
 * @returns The same embed, for chaining.
 */
export function applyLfgPlayerInviteEmbed(
  embed: DmEmbed,
  payload: Record<string, unknown>,
): DmEmbed {
  const input = readLfgPlayerInvitePayload(payload);
  embed.setAuthor({ name: lfgPlayerInviteAuthorLine(input.inviterName) });
  embed.setDescription(buildLfgPlayerInviteLines(input).join('\n'));
  return addPersonalizedFields(embed, pickLfgPlayerInviteFields(input));
}

/**
 * The decline row (D12). Identity is NEVER in the custom id — only the game —
 * so a replayed id can only ever decline the clicker's own invite.
 *
 * @returns The row, or undefined when the payload carries no usable game id.
 */
export function buildLfgPlayerInviteRow(
  payload: Record<string, unknown> | undefined,
): ActionRowBuilder<ButtonBuilder> | undefined {
  const gameId = Number(payload?.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) return undefined;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${LFG_BUTTON_IDS.INVITE_DECLINE}:${gameId}`)
      .setLabel(LFG_INVITE_DECLINE_LABEL)
      .setStyle(ButtonStyle.Secondary),
  );
}
