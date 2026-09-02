/**
 * ROK-1459 (slice A) — shared embed chrome.
 *
 * One place turns a lifecycle *state* into a colour, and one place writes the
 * author line, the footer and the timestamp. Families keep their own layout;
 * they stop owning their chrome. See `planning-artifacts/specs/ROK-1459.md`.
 */
import { EmbedBuilder, type APIEmbedField, type RestOrArray } from 'discord.js';
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

/** Throw if any field is one only the reader should see. */
function assertFieldsNotPersonalized(
  fields: readonly { name: string }[],
): void {
  for (const field of fields) {
    if (PERSONALIZED_FIELD_NAMES.has(field.name)) {
      throw new Error('personalized field on channel embed');
    }
  }
}

/** Belt-and-braces companion to the `DmEmbed` phantom type. */
function assertNoPersonalizedFields(embed: EmbedBuilder): void {
  assertFieldsNotPersonalized(embed.data.fields ?? []);
}

/**
 * A builder that refuses a personalized field at WRITE time, so the guard bites
 * even when a caller adds fields after `createChannelEmbed` returned (ROK-1459).
 */
class ChannelEmbedBuilder extends EmbedBuilder {
  override addFields(...fields: RestOrArray<APIEmbedField>): this {
    assertFieldsNotPersonalized(fields.flat());
    return super.addFields(...fields);
  }

  override setFields(...fields: RestOrArray<APIEmbedField>): this {
    assertFieldsNotPersonalized(fields.flat());
    return super.setFields(...fields);
  }

  override spliceFields(
    index: number,
    deleteCount: number,
    ...fields: APIEmbedField[]
  ): this {
    assertFieldsNotPersonalized(fields);
    return super.spliceFields(index, deleteCount, ...fields);
  }
}

/**
 * Refuse Discord timestamp markup on a chrome slot.
 *
 * Operator walk 2026-09-02: Discord renders `<t:epoch:style>` in an embed's
 * DESCRIPTION and fields, but NOT in the author line or the footer — both
 * showed the literal token to every reader. Families must format the instant
 * server-side (`formatEpoch` / `formatRelativeEpoch`), so the chrome rejects
 * the markup outright rather than leaving the next family to rediscover it.
 *
 * @param value - The author line or footer label about to be written.
 * @param slot - Which slot is being written, for the error message.
 * @throws If the value carries `<t:` markup.
 */
function assertNoTimestampMarkup(
  value: string | undefined,
  slot: 'authorLine' | 'footerLabel',
): void {
  if (value?.includes('<t:')) {
    throw new Error(
      `Discord timestamp markup in ${slot}: Discord does not render <t:…> ` +
        'in an author line or footer — format the time server-side ' +
        `(got ${JSON.stringify(value)})`,
    );
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
  assertNoTimestampMarkup(opts.authorLine, 'authorLine');
  assertNoTimestampMarkup(opts.footerLabel, 'footerLabel');

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
  const embed = new ChannelEmbedBuilder();
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
