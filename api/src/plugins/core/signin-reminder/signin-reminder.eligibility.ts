/**
 * ROK-2284 — the roster half of eligibility (pure): drop bots and people who
 * joined after launch less than 3 days ago (ruled Q3). Everything else —
 * account holders, opt-outs, cap, cadence, recent 50007 — is decided by the
 * claim query (`signin-reminder.db.ts`).
 */
import type { ReminderRosterMember } from '../../../discord-bot/discord-bot-client.guild.helpers';
import { SIGNIN_REMINDER_JOIN_WAIT_DAYS } from './signin-reminder.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** True while a post-launch joiner is still inside the 3-day wait. */
export function isInsideJoinWait(
  joinedAt: Date | null,
  launchedAt: Date,
  now: Date,
): boolean {
  if (joinedAt === null || joinedAt.getTime() <= launchedAt.getTime()) {
    return false;
  }
  return (
    now.getTime() - joinedAt.getTime() < SIGNIN_REMINDER_JOIN_WAIT_DAYS * DAY_MS
  );
}

/** Discord ids of human members past the join wait, de-duplicated. */
export function reminderCandidateIds(
  roster: readonly ReminderRosterMember[],
  launchedAt: Date,
  now: Date,
): string[] {
  const ids = roster
    .filter((m) => !m.isBot)
    .filter((m) => !isInsideJoinWait(m.joinedAt, launchedAt, now))
    .map((m) => m.discordId);
  return [...new Set(ids)];
}

/**
 * DEMO_MODE smoke targeting only: `[botId]` when that id is a BOT in the
 * roster, else `[]`. The smoke has no human it may DM, and the regular pass
 * drops every bot — so the fixture can aim one tick at a bot and never at a
 * person. Never used by the cron.
 */
export function targetedBotIds(
  roster: readonly ReminderRosterMember[],
  botId: string,
): string[] {
  return roster.some((m) => m.isBot && m.discordId === botId) ? [botId] : [];
}
