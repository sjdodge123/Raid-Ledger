/**
 * ROK-2271 — every word a signup line posts into an event's Discord thread.
 * A copy veto is a change to THIS file only; the diff logic
 * (`hub-forum-discord-signup-lines.ts`) never spells a user-facing string.
 *
 * `{who}` is the member: `<@id>` on their first line in the thread, their
 * display name (no ping) on every later one.
 */

/** Roster role ids → the label a line shows. Unknown ids pass through. */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  tank: 'Tank',
  healer: 'Healer',
  dps: 'DPS',
  flex: 'Flex',
};

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
  tentative: { emoji: '🤔', text: 'is tentative' },
  back: { emoji: '↩️', text: 'is back' },
  backTentative: { emoji: '↩️', text: 'is back (tentative)' },
  confirmed: { emoji: '✅', text: 'is confirmed (was tentative)' },
  nowTentative: { emoji: '🤔', text: 'is now tentative' },
  benched: { emoji: '🪑', text: 'benched' },
  promoted: { emoji: '⬆️', text: 'promoted from bench' },
  roleChange: {
    emoji: '🔁',
    text: (from: string, to: string) => `${from} → ${to}`,
  },
  characterChange: { emoji: '🛡️', text: (ch: string) => `now on ${ch}` },
  late: { emoji: '⏰', text: 'is running late' },
  lateMinutes: {
    emoji: '⏰',
    text: (m: number) => `is running late (~${m} min)`,
  },
  onTime: { emoji: '👍', text: 'is on time again' },
  declined: { emoji: '👋', text: "can't make it" },
  departed: { emoji: '👋', text: 'left the event' },
  roachedOut: { emoji: '🪳', text: 'roached out' },
  roachedOutHours: {
    emoji: '🪳',
    text: (h: string) => `roached out (${h} h before start)`,
  },
} as const;
