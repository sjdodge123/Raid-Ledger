/**
 * ROK-2295 / ROK-2301 / ROK-2315: what a scheduling poll's thread is called.
 * Discord's forum sidebar cuts a post title at about 30 characters, so the
 * part that tells polls apart comes first:
 * - reschedule poll: `Reschedule: <event> — Poll`;
 * - follow-up poll (opened from an ended event's "Schedule a follow-up?"
 *   prompt): `<event> — Follow-up poll`;
 * - plain poll with a parent-lineup deadline: `Poll · closes Thu 26 Nov — <game>`;
 * - any other poll: `<game> — Poll`.
 * The Raid Ledger thread (120) and the Discord post (100) share
 * `pollTitleWithin`, each with its own limit. Pure.
 */
import { eventPostDate } from '../discord/hub-forum-discord-event-outbound';
import type { PollSyncRow } from './poll-discussion.queries';

/** The poll fields a thread title reads. */
export type PollTitleFields = Pick<
  PollSyncRow,
  | 'linkedEventId'
  | 'linkedEventTitle'
  | 'gameName'
  | 'followupOfEventTitle'
  | 'phaseDeadline'
>;

const FOLLOWUP_TAIL = ' — Follow-up poll';
const CLOSES = 'Poll · closes ';
const DASH = ' — ';
const ELLIPSIS = '…';
const GAME_FALLBACK = 'Scheduling';

const points = (text: string): string[] => Array.from(text);

/** The first `room` code points of `text`, trailing space dropped. */
const cutTo = (text: string, room: number): string =>
  points(text).slice(0, room).join('').trimEnd();

/**
 * ROK-2295: the event a reschedule poll is for, or null (unlinked, gone,
 * produced by this poll at lock-in, or an empty title).
 */
export function rescheduledEvent(
  poll: Pick<PollSyncRow, 'linkedEventId' | 'linkedEventTitle'>,
): { title: string } | null {
  const title = poll.linkedEventTitle?.trim() ?? '';
  if (poll.linkedEventId === null || title.length === 0) return null;
  return { title };
}

/**
 * ROK-2295: the poll's goal. A reschedule poll (linked event) gives
 * `Reschedule: <event title>`; any other poll gives its game. A standalone
 * poll's storage lineup title is synthetic and never surfaces. This is the
 * plain subject: prose uses it as is, thread titles go through
 * `pollTitleWithin`.
 */
export function pollSubjectTitle(
  poll: Pick<PollSyncRow, 'linkedEventId' | 'linkedEventTitle' | 'gameName'>,
): string {
  const event = rescheduledEvent(poll);
  return event ? `Reschedule: ${event.title}` : poll.gameName;
}

/**
 * ROK-2301: the event a follow-up poll came after, or null when there is
 * none, its title is blank, or the poll is a reschedule (which wins).
 */
export function followupEventTitle(
  poll: Pick<
    PollSyncRow,
    'linkedEventId' | 'linkedEventTitle' | 'followupOfEventTitle'
  >,
): string | null {
  if (rescheduledEvent(poll)) return null;
  const title = poll.followupOfEventTitle?.trim() ?? '';
  return title.length > 0 ? title : null;
}

/**
 * ROK-2315: `<event> — Follow-up poll` in at most `max` code points. The
 * event title is what gets cut (ending with `…`); null when not even one
 * character of it fits, so the caller falls back to the plain title.
 */
export function followupPollTitle(event: string, max: number): string | null {
  const whole = `${event}${FOLLOWUP_TAIL}`;
  if (points(whole).length <= max) return whole;
  const room = max - points(FOLLOWUP_TAIL).length - points(ELLIPSIS).length;
  if (room < 1) return null;
  return `${cutTo(event, room)}${ELLIPSIS}${FOLLOWUP_TAIL}`;
}

/**
 * ROK-2315: `Poll · closes <date> — <game>` in at most `max` code points.
 * The game is what gets cut (ending with `…`); null when not even one
 * character of it fits.
 */
export function deadlinePollTitle(
  game: string,
  date: string,
  max: number,
): string | null {
  const head = `${CLOSES}${date}${DASH}`;
  const subject = game.trim() || GAME_FALLBACK;
  const whole = `${head}${subject}`;
  if (points(whole).length <= max) return whole;
  const room = max - points(head).length - points(ELLIPSIS).length;
  if (room < 1) return null;
  return `${head}${cutTo(subject, room)}${ELLIPSIS}`;
}

/**
 * The deadline a plain poll's title reads, or null when the title is not the
 * dated form (a reschedule, a follow-up, or no deadline). Classified with
 * `rescheduledEvent`, not `linkedEventId`: a poll that PRODUCED its event at
 * lock-in gets `linkedEventId` but no `linkedEventTitle`, and must keep its
 * dated title rather than be renamed on POLL_LOCKED_IN.
 */
function datedDeadline(poll: PollTitleFields): Date | null {
  if (rescheduledEvent(poll) !== null) return null;
  if (followupEventTitle(poll) !== null) return null;
  return poll.phaseDeadline;
}

/** The leading-form title (follow-up or dated) when one applies, else null. */
function leadingTitle(
  poll: PollTitleFields,
  max: number,
  timeZone: string | null,
): string | null {
  const event = followupEventTitle(poll);
  if (event !== null) return followupPollTitle(event, max);
  const deadline = datedDeadline(poll);
  if (deadline === null) return null;
  const date = eventPostDate(deadline, timeZone);
  return deadlinePollTitle(poll.gameName, date, max);
}

/**
 * The poll's full thread title within `max`: the follow-up or dated form
 * when it applies and fits, else `plain(<subject>)`, the caller's own
 * `<subject> — Poll` cut. `timeZone` is the community default
 * (`DEFAULT_TIMEZONE`) the close date is read in; null ⇒ UTC.
 */
export function pollTitleWithin(
  poll: PollTitleFields,
  max: number,
  plain: (subject: string) => string,
  timeZone: string | null,
): string {
  return leadingTitle(poll, max, timeZone) ?? plain(pollSubjectTitle(poll));
}

/**
 * True when the title reads the close date (the same classifier
 * `pollTitleWithin` uses), so a caller knows whether it needs the community
 * timezone.
 */
export function pollTitleNeedsZone(poll: PollTitleFields): boolean {
  return datedDeadline(poll) !== null;
}
