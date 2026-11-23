/**
 * ROK-2273 — the ONE table of glyphs a signup's state wears in Discord.
 * The channel embed's roster (tentative / running late), the reminder DM's
 * buttons (roach out / running late), `/roster` (bench / flex) and the
 * event thread's signup lines all import it, so a reader sees one
 * vocabulary (operator ruling 2026-11-20). Role and class glyphs are
 * per-guild and come from `DiscordEmojiService` instead.
 */
export const SIGNUP_STATE_EMOJI = {
  tentative: '⏳',
  late: '⏰',
  roachOut: '🪳',
  bench: '🪑',
  flex: '🔀',
} as const;
