/**
 * ROK-1459 (slice A) — DM-only personalized embed fields.
 *
 * A "personalized" field says something about the *reader* (they own the game,
 * it is on their wishlist, they hearted it). Those statements are only true for
 * one person, so they may never appear on a channel embed. The DM-only rule is
 * enforced twice: at compile time by the `DmEmbed` phantom brand this module
 * accepts, and at runtime by `applyEmbedChrome`, which refuses to chrome a
 * channel embed carrying any name in `PERSONALIZED_FIELD_NAMES`.
 */
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
  for (const field of fields) {
    embed.addFields({
      name: canonicalName(field),
      value: field.value,
      ...(field.inline === undefined ? {} : { inline: field.inline }),
    });
  }
  return embed;
}
