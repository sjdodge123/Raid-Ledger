/**
 * ROK-1728: customId prefixes for the series-signup Discord flow.
 *
 * Kept out of `SIGNUP_BUTTON_IDS` on purpose: `parseButtonCustomId`'s
 * whitelist (`signup-interaction.helpers.ts`) must never match these, so the
 * per-night signup listener stays untouched. Grammar: `<prefix>:<eventId>`.
 */
export const SERIES_BUTTON_IDS = {
  JOIN: 'series_join',
  CONFIRM: 'series_confirm',
  CHARACTER: 'series_char',
  ROLE: 'series_role',
  SKIP: 'series_skip',
  LEAVE: 'series_leave',
} as const;

export type SeriesButtonId =
  (typeof SERIES_BUTTON_IDS)[keyof typeof SERIES_BUTTON_IDS];
