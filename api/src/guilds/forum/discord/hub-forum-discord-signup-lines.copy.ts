/**
 * ROK-2271 — every word a signup line posts into an event's Discord thread.
 * A copy veto is a change to THIS file only; the diff logic
 * (`hub-forum-discord-signup-lines.ts`) never spells a user-facing string.
 *
 * `{who}` is the member: `<@id>` on their first line in the thread, their
 * display name (no ping) on every later one.
 *
 * ROK-2273: a glyph the channel embed, the reminder DM or `/roster` also
 * shows is imported from `SIGNUP_STATE_EMOJI`, never spelled here; role and
 * class glyphs come from `DiscordEmojiService` (see `SignupLineEmoji`). The
 * glyphs below are the fallbacks for a change with no role/class glyph, and
 * the kinds the embed has no glyph for.
 */
import { SIGNUP_STATE_EMOJI as STATE } from '../../../discord-bot/embeds/signup-state-emoji.constants';

/** Roster role ids → the label a line shows. Unknown ids pass through. */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  tank: 'Tank',
  healer: 'Healer',
  dps: 'DPS',
  flex: 'Flex',
};

/** A member with no display name, username or Discord username on file. */
export const UNKNOWN_MEMBER_NAME = 'A player';

/** Shown in place of a role for a benched signup. */
export const BENCH_LABEL = 'Bench';
/** Shown for "no role" on either side of a role change. */
export const NO_ROLE_LABEL = 'no role';

/** Between the opening clause and the role/character detail. */
export const DETAIL_SEPARATOR = ' — ';
/** Between details (role · character) and between combined changes. */
export const PART_SEPARATOR = ' · ';

/** Emoji + wording of each kind of line fragment. */
export const SIGNUP_LINE_COPY = {
  signedUp: { emoji: '✅', text: 'signed up' },
  tentative: { emoji: STATE.tentative, text: 'is tentative' },
  back: { emoji: '↩️', text: 'is back' },
  backTentative: { emoji: STATE.tentative, text: 'is back (tentative)' },
  confirmed: { emoji: '✅', text: 'is confirmed (was tentative)' },
  nowTentative: { emoji: STATE.tentative, text: 'is now tentative' },
  benched: { emoji: STATE.bench, text: 'benched' },
  /** Leads with the new role's glyph; this one only when it has none. */
  promoted: { emoji: '⬆️', text: 'promoted from bench' },
  /** Leads with the new role's glyph; this one only when it has none. */
  roleChange: {
    emoji: '🔁',
    text: (from: string, to: string) => `${from} → ${to}`,
  },
  /** Leads with the new class glyph; 🔁 (never a role glyph) otherwise. */
  characterChange: { emoji: '🔁', text: (ch: string) => `now on ${ch}` },
  late: { emoji: STATE.late, text: 'is running late' },
  lateMinutes: {
    emoji: STATE.late,
    text: (m: number) => `is running late (~${m} min)`,
  },
  onTime: { emoji: '👍', text: 'is on time again' },
  /** The signup button's word for this state is `Decline`. */
  declined: { emoji: '👋', text: 'declined' },
  departed: { emoji: '👋', text: 'left the event' },
  roachedOut: { emoji: STATE.roachOut, text: 'roached out' },
  roachedOutHours: {
    emoji: STATE.roachOut,
    text: (h: string) => `roached out (${h} h before start)`,
  },
} as const;
