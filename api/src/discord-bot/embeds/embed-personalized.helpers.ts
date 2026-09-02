/**
 * ROK-1459 (slice A) — DM-only personalized embed fields.
 *
 * A "personalized" field says something about the *reader* (they own the game,
 * it is on their wishlist, they hearted it). Those statements are only true for
 * one person, so they may never appear on a channel embed.
 *
 * Enforcement (ROK-1459 slice A) covers embeds created via `createChannelEmbed`
 * — which rejects a personalized field at write time — and any embed chromed via
 * `applyEmbedChrome({ surface: 'channel' })`, which refuses to chrome one that
 * already carries such a field. Compile time is covered by the `DmEmbed` phantom
 * brand this module accepts. Builders that still construct a bare
 * `new EmbedBuilder()` are NOT write-time guarded; they migrate onto
 * `createChannelEmbed` in slices B/C.
 */
import { EmbedBuilder, type APIEmbedField } from 'discord.js';
import type { DmEmbed } from './embed-chrome.helpers';

/** The kinds of reader-specific statement an embed may carry. */
export type PersonalizedKind = 'owned' | 'wishlist' | 'hearted';

/** A single reader-specific field destined for a DM embed. */
export interface PersonalizedField {
  kind: PersonalizedKind;
  name: string;
  value: string;
  inline?: boolean;
}

/** Canonical field name per kind — the only names this module emits. */
const KIND_FIELD_NAMES: Record<PersonalizedKind, string> = {
  owned: '\u{1F3AE} In your library',
  wishlist: '\u{2B50} On your wishlist',
  hearted: '\u{1F49B} You hearted this',
};

/**
 * Closed vocabulary of personalized field names. `applyEmbedChrome` treats any
 * of these on a channel embed as a bug and throws.
 */
export const PERSONALIZED_FIELD_NAMES: ReadonlySet<string> = new Set(
  Object.values(KIND_FIELD_NAMES),
);

/** Caller-supplied names are honoured only if they are already canonical. */
function canonicalName(field: PersonalizedField): string {
  return PERSONALIZED_FIELD_NAMES.has(field.name)
    ? field.name
    : KIND_FIELD_NAMES[field.kind];
}

/**
 * Append reader-specific fields to a DM embed.
 *
 * Accepts ONLY a `DmEmbed`; passing a `ChannelEmbed` is a compile error.
 *
 * @param embed - The DM embed to mutate.
 * @param fields - Reader-specific fields; an empty list is a no-op.
 * @returns The same embed, for chaining.
 */
export function addPersonalizedFields(
  embed: DmEmbed,
  fields: readonly PersonalizedField[],
): DmEmbed {
  const toAppend: APIEmbedField[] = fields.map((field) => ({
    name: canonicalName(field),
    value: field.value,
    ...(field.inline === undefined ? {} : { inline: field.inline }),
  }));
  if (toAppend.length === 0) return embed;

  // Written through the BASE builder on purpose: the `DmEmbed` parameter type is
  // the guard for this path, so a channel embed can only get here through a
  // forced `@ts-expect-error` call — and `applyEmbedChrome` still refuses to
  // chrome the contaminated result (the AC3 belt-and-braces pairing).
  EmbedBuilder.prototype.addFields.call(embed, toAppend);
  return embed;
}
