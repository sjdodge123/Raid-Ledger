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
  warning: z.object({ missing: z.array(z.string()) }).optional(),
});

export type BotInviteInfo = z.infer<typeof BotInviteInfoSchema>;
export type LfgBoardSettings = z.infer<typeof LfgBoardSettingsSchema>;
export type LfgBoardSettingsResponse = z.infer<
  typeof LfgBoardSettingsResponseSchema
>;
