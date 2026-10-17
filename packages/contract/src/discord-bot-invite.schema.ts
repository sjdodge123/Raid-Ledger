import { z } from 'zod';

/**
 * ROK-1471 (D4/AC11): the generated bot install URL.
 *
 * `permissions` is the human-readable label list the URL grants — derived from
 * the API's `REQUIRED_PERMISSIONS`, never a hardcoded integer (AC15). `url` is
 * null when no client id is known (bot token unset or invalid); the labels are
 * still returned so the admin page can explain what an install would ask for.
 */
export const BotInviteInfoSchema = z.object({
  url: z.string().nullable(),
  permissions: z.array(z.string()),
  clientId: z.string().nullable(),
});

/** Body of `PUT /admin/settings/discord-bot/lfg-board` — the D1 master toggle. */
export const LfgBoardSettingsSchema = z.object({
  enabled: z.boolean(),
});

/** One emoji element: a pictograph, its presentation/skin-tone marks, tags. */
const EMOJI_ELEMENT =
  '\\p{Extended_Pictographic}\\uFE0F?\\p{Emoji_Modifier}?\\uFE0F?' +
  '(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?';

/**
 * A single Unicode emoji grapheme: a flag (regional-indicator pair), a keycap,
 * or pictographs joined by ZWJ (👨‍👩‍👧‍👦), with variation selectors and skin tones.
 */
const UNICODE_EMOJI_RE = new RegExp(
  `^(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|` +
    `${EMOJI_ELEMENT}(?:\\u200D${EMOJI_ELEMENT})*)$`,
  'u',
);

/** A custom Discord emoji: `<:name:id>`, `<a:name:id>` or `:name:`. */
const CUSTOM_EMOJI_REF_RE = /^(?:<a?:\w{2,32}:\d{5,25}>|:\w{2,32}:)$/;

/**
 * ROK-1619: is `value` something Discord accepts as a button emoji? Anything
 * else would be sent as a Unicode `{ name }` and make Discord reject the whole
 * board post and invite DM ("Invalid emoji"). Blank is valid (= 🎉).
 */
export function isLfgNowIndicatorEmoji(value: string): boolean {
  return (
    value === '' ||
    UNICODE_EMOJI_RE.test(value) ||
    CUSTOM_EMOJI_REF_RE.test(value)
  );
}

/**
 * Body of `PUT /admin/settings/discord-bot/lfg-board/indicator-emoji` (ROK-1619).
 * One Unicode emoji or a custom emoji reference (`:name:`, `<:name:id>`); a
 * blank string clears it back to the 🎉 default.
 */
export const LfgNowIndicatorEmojiSchema = z.object({
  emoji: z
    .string()
    .trim()
    .max(64)
    .refine(isLfgNowIndicatorEmoji, {
      message:
        'Must be a single emoji (like 🔥) or a server emoji (like :praise_sun: or <:praise_sun:123>)',
    }),
});
export type LfgNowIndicatorEmojiBody = z.infer<typeof LfgNowIndicatorEmojiSchema>;

/**
 * Response of the LFG-board toggle endpoints.
 *
 * `warning` is ADVISORY (D5): the toggle is always persisted, even when the
 * preflight finds missing permissions, because the operator is often about to
 * fix the install. A 4xx here would be wrong.
 */
export const LfgBoardSettingsResponseSchema = z.object({
  enabled: z.boolean(),
  /**
   * Id of the forum channel the bot created for the board, or null when it has
   * not been created yet (the listener creates it asynchronously after the
   * toggle flips). Present on GET; omitted from the PUT echo, which answers
   * before the channel exists. The smoke polls this instead of guessing the
   * channel by name — a guild can hold several channels named `lfg`.
   */
  channelId: z.string().nullable().optional(),
  /** ROK-1619: the raw indicator-emoji setting; null when unset (🎉). GET only. */
  nowIndicatorEmoji: z.string().nullable().optional(),
  warning: z.object({ missing: z.array(z.string()) }).optional(),
});

export type BotInviteInfo = z.infer<typeof BotInviteInfoSchema>;
export type LfgBoardSettings = z.infer<typeof LfgBoardSettingsSchema>;
export type LfgBoardSettingsResponse = z.infer<
  typeof LfgBoardSettingsResponseSchema
>;
