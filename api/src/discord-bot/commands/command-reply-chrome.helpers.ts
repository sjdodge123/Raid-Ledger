/**
 * ROK-1462 (slice D) — chrome for slash-command replies.
 *
 * Command replies are the admin's first impression of the bot and were the
 * least consistent surface: five titles, four colours, settings buried in a
 * prose description. D5 puts every reply on `createChannelEmbed` with
 * `state: 'done'` (slate) and moves the state into the author line; D6 moves
 * the binding settings into inline fields that use the SAME nouns as the admin
 * form (`per game`, `in channel`, `after group empties` — D7 / AC6).
 *
 * This module owns the copy only. `bind` / `unbind` / `events-list` call it and
 * never build chrome of their own (D9: those files get delegate calls, not
 * growth; D10 guards that none of them still call `.setColor`).
 */
import type { APIEmbedField } from 'discord.js';
import type {
  BindingPurpose,
  ChannelBindingConfig,
} from '@raid-ledger/contract';
import {
  AUTO_CLOSE_LABEL,
  AUTO_CLOSE_TRIGGER_NOUN,
  BINDING_PURPOSE_LABELS,
  JUST_CHATTING_LABEL,
  MIN_PLAYERS_LABEL,
  MIN_PLAYERS_UNIT,
} from '@raid-ledger/contract';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';

// Re-exported so a command file imports its copy from one place. These ARE the
// contract constants — the admin form imports the same objects (AC5/AC6).
export {
  AUTO_CLOSE_LABEL,
  AUTO_CLOSE_TRIGGER_NOUN,
  BINDING_PURPOSE_LABELS,
  JUST_CHATTING_LABEL,
  MIN_PLAYERS_LABEL,
  MIN_PLAYERS_UNIT,
};

/**
 * Author lines, one per reply state. Glyph + SCREAMING state, no markdown and
 * no `<t:…>` — Discord renders neither in an author line (ROK-1459).
 */
export const COMMAND_REPLY_AUTHORS = {
  /** `/bind` bound a channel. */
  BIND_SAVED: '⚙ BINDING SAVED',
  /** `/bind event:` set a per-event channel/game override. */
  EVENT_BIND_SAVED: '⚙ EVENT BINDING SAVED',
  /** `/bind` refused: the channel already monitors that game (`cancelled`). */
  BIND_REJECTED: '✕ BINDING REJECTED',
  /** `/bind` needs a Continue/Cancel answer first (`needs_you`). */
  BIND_CONFIRM: '⚠ CONFIRM BINDING',
  /** `/unbind` removed a channel binding. Settled, not an error — slate. */
  UNBIND_REMOVED: '⚙ BINDING REMOVED',
  /** `/unbind event:` cleared a per-event override. */
  EVENT_UNBIND_REMOVED: '⚙ EVENT BINDING REMOVED',
  /** `/events` drill-down into one event. */
  EVENT_DETAIL: '📋 EVENT DETAILS',
} as const;

/** Runtime default when `config.minPlayers` is unset (voice-state handlers). */
export const DEFAULT_MIN_PLAYERS = 2;
/** Runtime default when `config.gracePeriod` is unset (ad-hoc-event handlers). */
export const DEFAULT_GRACE_PERIOD_MINUTES = 5;

/** The binding facts a `/bind` or `/unbind` reply renders as inline fields. */
export interface CommandReplyBinding {
  /** Channel name WITHOUT the leading `#`. */
  channelName: string;
  purpose: BindingPurpose;
  config?: ChannelBindingConfig | null;
  seriesTitle?: string | null;
  gameName?: string | null;
}

/** The voice-tuning fields. Announcement channels carry none of them (AC5). */
function voiceSettingsFields(
  purpose: BindingPurpose,
  config: ChannelBindingConfig | null | undefined,
): APIEmbedField[] {
  const minPlayers = config?.minPlayers ?? DEFAULT_MIN_PLAYERS;
  const grace = config?.gracePeriod ?? DEFAULT_GRACE_PERIOD_MINUTES;
  const fields: APIEmbedField[] = [
    {
      name: MIN_PLAYERS_LABEL,
      value: `${minPlayers} ${MIN_PLAYERS_UNIT[purpose]}`,
      inline: true,
    },
  ];
  if (purpose === 'general-lobby') {
    fields.push({
      name: JUST_CHATTING_LABEL,
      value: config?.allowJustChatting ? 'Enabled' : 'Disabled',
      inline: true,
    });
  }
  // D8(b): auto-close is no longer a toggle, so this states the FACT — there is
  // no `Off` value to render. The grace period is the only tunable left.
  fields.push({
    name: AUTO_CLOSE_LABEL,
    value: `${grace} min ${AUTO_CLOSE_TRIGGER_NOUN}`,
    inline: true,
  });
  return fields;
}

/**
 * The binding's settings as inline embed fields (D6).
 *
 * Announcement channels get `Channel` plus `Series` / `Game` when set; voice
 * purposes additionally get the tuning fields. Values carry no markdown and no
 * timestamp markup so they read the same to every admin.
 *
 * @param binding - Channel name, resolved purpose, stored config and optional
 *   series / game labels.
 * @returns Inline fields in render order, `Channel` always first.
 */
export function settingsFields(binding: CommandReplyBinding): APIEmbedField[] {
  const fields: APIEmbedField[] = [
    {
      name: 'Channel',
      value: `#${binding.channelName} → ${BINDING_PURPOSE_LABELS[binding.purpose]}`,
      inline: true,
    },
  ];
  if (binding.purpose !== 'game-announcements') {
    fields.push(...voiceSettingsFields(binding.purpose, binding.config));
  }
  if (binding.seriesTitle) {
    fields.push({ name: 'Series', value: binding.seriesTitle, inline: true });
  }
  if (binding.gameName) {
    fields.push({ name: 'Game', value: binding.gameName, inline: true });
  }
  return fields;
}

/**
 * Author line for the `/events` list (D5) — the count lives in the chrome, not
 * in a title.
 *
 * @param shown - Events rendered in this page.
 * @param total - Upcoming events that matched.
 * @returns e.g. `📋 UPCOMING EVENTS · 3 of 12`.
 */
export function eventsListAuthorLine(shown: number, total: number): string {
  return `📋 UPCOMING EVENTS · ${shown} of ${total}`;
}

/**
 * Footer label for the `/events` list (D5) — the old bespoke footer sentence
 * folded into the chrome's `${community} · ${label}` slot.
 *
 * @param shown - Events rendered in this page.
 * @param total - Upcoming events that matched.
 * @returns e.g. `Showing 3 of 12`.
 */
export function eventsListFooterLabel(shown: number, total: number): string {
  return `Showing ${shown} of ${total}`;
}

/**
 * The `/unbind` reply (D5 / AC2).
 *
 * A removed binding is a SETTLED outcome, not an error — it reads slate `done`
 * with the state in the author line, replacing the old red `Channel Unbound`
 * title that coloured a success like a failure.
 *
 * @param channelName - Unbound channel's name, without the leading `#`.
 * @param seriesTitle - Series title when the unbind was series-scoped.
 * @returns The reply embed.
 */
export function buildUnbindEmbed(
  channelName: string,
  seriesTitle: string | null,
): ChannelEmbed {
  const embed = createChannelEmbed({
    state: 'done',
    authorLine: COMMAND_REPLY_AUTHORS.UNBIND_REMOVED,
  });
  embed.setTitle(`#${channelName}`);
  if (seriesTitle) {
    embed.addFields({ name: 'Series', value: seriesTitle, inline: true });
  }
  return embed;
}

/**
 * The `/unbind event:` reply (D5 / AC2) — a cleared per-event override.
 *
 * @param eventTitle - The event whose override was cleared.
 * @returns The reply embed.
 */
export function buildEventUnbindEmbed(eventTitle: string): ChannelEmbed {
  const embed = createChannelEmbed({
    state: 'done',
    authorLine: COMMAND_REPLY_AUTHORS.EVENT_UNBIND_REMOVED,
  });
  embed.setTitle(eventTitle);
  embed.setDescription(
    'Notification channel override removed — embeds fall back to the ' +
      'default channel resolution.',
  );
  return embed;
}
