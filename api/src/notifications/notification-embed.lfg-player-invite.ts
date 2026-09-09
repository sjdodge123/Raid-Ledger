/**
 * DM body for a PLAYER-sent LFG invite (ROK-1455 D11).
 *
 * `lfg_player_invite` rides the ordinary notification pipeline, so the chrome
 * (colour, footer, the Adjust-Notifications row) comes from
 * `DiscordNotificationEmbedService`. This module owns what is specific to the
 * card: the `✉ Invited by …` author line, the description (game, the GROUP's
 * horizon, why you were suggested, what joining does), the Join · View ·
 * Not-interested button row, and at most
 * {@link LFG_PLAYER_INVITE_MAX_PERSONALIZED} reader-only fields.
 *
 * The personalized fields go through `addPersonalizedFields`, which accepts
 * ONLY a `DmEmbed` — so the "personalized field leaks into a channel" failure
 * the design warns about is a compile error, not a runtime one.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { LfgSuggestionReason, LfgUrgency } from '@raid-ledger/contract';
import { LFG_BUTTON_IDS } from '../discord-bot/discord-bot.constants';
import type { DmEmbed } from '../discord-bot/embeds/embed-chrome.helpers';
import {
  addPersonalizedFields,
  personalizedFieldName,
  type PersonalizedField,
} from '../discord-bot/embeds/embed-personalized.helpers';
import { lfgViewGroupButton } from '../discord-bot/embeds/lfg-view-group-button.helpers';

/**
 * Re-exported from its shared home so the ephemeral Join reply and this card
 * render the SAME button (walk feedback 4). Importing the listener's module
 * here would close a notifications -> discord-bot -> notifications cycle.
 */
export { LFG_INVITE_VIEW_LABEL } from '../discord-bot/embeds/lfg-view-group-button.helpers';

/** Design cap (`design-embed-system:466`): "Keep it to two fields". */
export const LFG_PLAYER_INVITE_MAX_PERSONALIZED = 2;

/** The decline button's label (D12). */
export const LFG_INVITE_DECLINE_LABEL = 'Not interested';

/** The DM's own Join button (walk feedback) — never the board's `+1`. */
export const LFG_INVITE_JOIN_LABEL = 'Join the group';

/** Says what accepting actually DOES — the DM never explained it (walk 1). */
export const LFG_PLAYER_INVITE_JOIN_EXPLAINER =
  "Joining puts your hand up — you'll be pinged when the group fills.";

/** A week group's horizon line (walk 2). */
export const LFG_PLAYER_INVITE_WEEK_HORIZON = '🎯 Looking to play this week';

/**
 * A now group's horizon line (walk 2).
 *
 * Rendered as Discord timestamp markup so the reader sees the deadline in
 * THEIR timezone — a server-formatted clock time is wrong for most invitees.
 *
 * @param expiresAt - When the group's longest-running `now` hand lapses.
 */
export function lfgPlayerInviteNowHorizon(expiresAt: Date | null): string {
  if (!expiresAt) return '🔥 Playing right now';
  return `🔥 Playing right now — until <t:${Math.floor(expiresAt.getTime() / 1000)}:t>`;
}

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
  /** The GROUP's horizon when the DM was sent — not the inviter's own hand. */
  urgency?: LfgUrgency | null;
  /** When the group's longest live `now` hand lapses; null on a week group. */
  nowExpiresAt?: Date | null;
}

/** The `✉ Invited by {name}` author line (AC7). */
export function lfgPlayerInviteAuthorLine(inviterName: string): string {
  return `✉ Invited by ${inviterName}`;
}

/**
 * Ordered description lines: game, horizon, why, what joining does.
 *
 * The masked `[Join the group](url)` line was REMOVED by the walk feedback:
 * the row now carries a real Join button and a link-style View button, and two
 * paths to the same place read worse than one.
 */
export function buildLfgPlayerInviteLines(
  input: LfgPlayerInviteDmInput,
): string[] {
  const why = input.reasons.map((r) => LFG_PLAYER_INVITE_REASON_COPY[r]);
  return [
    `\u{1F3AE} **${input.gameName}**`,
    input.urgency === 'now'
      ? lfgPlayerInviteNowHorizon(input.nowExpiresAt ?? null)
      : LFG_PLAYER_INVITE_WEEK_HORIZON,
    why.length > 0
      ? `You were suggested because ${why.join(', ')}.`
      : `${input.inviterName} thinks you'd be a good fit.`,
    LFG_PLAYER_INVITE_JOIN_EXPLAINER,
  ];
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
    // Anything but the literal `now` reads as `week`, so a payload written
    // before this field existed renders the week line rather than nothing.
    urgency: payload.urgency === 'now' ? 'now' : 'week',
    nowExpiresAt: readNowExpiresAt(payload.nowExpiresAt),
  };
}

/** `notifications.payload` is JSON, so the instant arrives as an ISO string. */
function readNowExpiresAt(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
 * The invite row: Join · View · Not interested (D12 + walk feedback 3/4).
 *
 * Identity is NEVER in a custom id — only the game — so a replayed id can only
 * ever act on the clicker's own invite. The urgency is NOT in the id either:
 * `LfgJoinListener` resolves the group's horizon at press time, so a DM read an
 * hour later cannot raise a now-hand on a group whose now-hands have lapsed.
 *
 * `INVITE_JOIN` is deliberately its own id: the board's `LFG_BUTTON_IDS.JOIN`
 * keeps raising a WEEK hand (ROK-1471) and must not be re-cut from here.
 *
 * @returns The row, or undefined when the payload carries no usable game id.
 */
export function buildLfgPlayerInviteRow(
  payload: Record<string, unknown> | undefined,
): ActionRowBuilder<ButtonBuilder> | undefined {
  const gameId = Number(payload?.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) return undefined;
  const url = typeof payload?.url === 'string' ? payload.url : null;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`${LFG_BUTTON_IDS.INVITE_JOIN}:${gameId}`)
      .setLabel(LFG_INVITE_JOIN_LABEL)
      .setStyle(ButtonStyle.Success),
  ];
  // A Link button without a URL is a Discord API error, so the View button is
  // present only when the payload actually carries the group link.
  if (url) buttons.push(lfgViewGroupButton(url));
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${LFG_BUTTON_IDS.INVITE_DECLINE}:${gameId}`)
      .setLabel(LFG_INVITE_DECLINE_LABEL)
      .setStyle(ButtonStyle.Secondary),
  );
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}
