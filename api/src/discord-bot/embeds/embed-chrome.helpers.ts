/**
 * ROK-1459 (slice A) — shared embed chrome.
 *
 * One place turns a lifecycle *state* into a colour, and one place writes the
 * author line, the footer and the timestamp. Families keep their own layout;
 * they stop owning their chrome. See `planning-artifacts/specs/ROK-1459.md`.
 */
import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
import { PERSONALIZED_FIELD_NAMES } from './embed-personalized.helpers';

/** Where an embed is rendered. Channel embeds are read by everyone. */
export type EmbedSurface = 'channel' | 'dm';

/** Lifecycle state of the thing an embed describes. Drives the colour. */
export type EmbedState =
  'announcing' | 'needs_you' | 'live' | 'done' | 'cancelled';

/** Fallback community name for author + footer. */
export const DEFAULT_COMMUNITY_NAME = 'Raid Ledger';

const STATE_COLORS: Record<EmbedState, number> = {
  announcing: EMBED_COLORS.ANNOUNCEMENT,
  needs_you: EMBED_COLORS.REMINDER,
  live: EMBED_COLORS.SIGNUP_CONFIRMATION,
  done: EMBED_COLORS.SYSTEM,
  cancelled: EMBED_COLORS.ERROR,
};

/**
 * State to palette colour. The ONLY place a state becomes a colour.
 *
 * @param state - Lifecycle state of the subject.
 * @returns The decimal colour from `EMBED_COLORS`.
 */
export function colorForState(state: EmbedState): number {
  return STATE_COLORS[state];
}

/** Chrome inputs shared by every embed family. */
export interface EmbedChromeOptions {
  surface: EmbedSurface;
  state: EmbedState;
  /** Author + footer fall back to `Raid Ledger` when absent. */
  communityName?: string | null;
  /** Overrides the author name, e.g. `▸ LIVE · 3 playing`. */
  authorLine?: string;
  authorUrl?: string;
  /** Footer becomes `${community} · ${label}` when supplied. */
  footerLabel?: string;
  /** Defaults to true. */
  timestamp?: boolean;
}

/** An embed proven to be destined for a channel. Phantom brand, no runtime cost. */
export type ChannelEmbed = EmbedBuilder & { readonly __surface: 'channel' };

/** An embed proven to be destined for a DM. Phantom brand, no runtime cost. */
export type DmEmbed = EmbedBuilder & { readonly __surface: 'dm' };

/** Belt-and-braces companion to the `DmEmbed` phantom type. */
function assertNoPersonalizedFields(embed: EmbedBuilder): void {
  for (const field of embed.data.fields ?? []) {
    if (PERSONALIZED_FIELD_NAMES.has(field.name)) {
      throw new Error('personalized field on channel embed');
    }
  }
}

/**
 * Apply the shared author / footer / colour / timestamp chrome to an embed.
 *
 * @param embed - The embed to mutate in place.
 * @param opts - Surface, state and the optional author/footer overrides.
 * @throws If a channel embed already carries a personalized (DM-only) field.
 */
export function applyEmbedChrome(
  embed: EmbedBuilder,
  opts: EmbedChromeOptions,
): void {
  if (opts.surface === 'channel') assertNoPersonalizedFields(embed);

  const community = opts.communityName?.trim() || DEFAULT_COMMUNITY_NAME;
  embed.setAuthor({
    name: opts.authorLine || community,
    ...(opts.authorUrl === undefined ? {} : { url: opts.authorUrl }),
  });
  embed.setFooter({
    text: opts.footerLabel ? `${community} · ${opts.footerLabel}` : community,
  });
  embed.setColor(colorForState(opts.state));
  if (opts.timestamp !== false) embed.setTimestamp();
}

/**
 * Create a channel-branded embed with the shared chrome already applied.
 *
 * @param opts - Chrome options minus `surface`.
 * @returns A new `ChannelEmbed`.
 */
export function createChannelEmbed(
  opts: Omit<EmbedChromeOptions, 'surface'>,
): ChannelEmbed {
  const embed = new EmbedBuilder();
  applyEmbedChrome(embed, { ...opts, surface: 'channel' });
  return embed as ChannelEmbed;
}

/**
 * Create a DM-branded embed with the shared chrome already applied.
 *
 * @param opts - Chrome options minus `surface`.
 * @returns A new `DmEmbed`, the only embed `addPersonalizedFields` accepts.
 */
export function createDmEmbed(
  opts: Omit<EmbedChromeOptions, 'surface'>,
): DmEmbed {
  const embed = new EmbedBuilder();
  applyEmbedChrome(embed, { ...opts, surface: 'dm' });
  return embed as DmEmbed;
}
