/**
 * ROK-2295 / ROK-2301: what a scheduling poll's thread is called. A
 * reschedule poll is `Reschedule: <event>`, a follow-up poll (opened from an
 * ended event's "Schedule a follow-up?" prompt) is
 * `<game> — Poll (after <event>)`, any other poll is its game. The Raid
 * Ledger thread (120) and the Discord post (100) share `pollTitleWithin`,
 * each with its own limit. Pure.
 */
import type { PollSyncRow } from './poll-discussion.queries';

/** The poll fields a thread title reads. */
export type PollTitleFields = Pick<
  PollSyncRow,
  'linkedEventId' | 'linkedEventTitle' | 'gameName' | 'followupOfEventTitle'
>;

const POLL_TAIL = ' — Poll';
const OPEN = ' (after ';
const CUT_CLOSE = '…)';
const GAME_FALLBACK = 'Scheduling';

const points = (text: string): string[] => Array.from(text);

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
 * `<game> — Poll (after <event>)` in at most `max` code points. The event
 * title is what gets cut (ending with `…`); null when not even one character
 * of it fits, so the caller falls back to the plain title.
 */
export function followupPollTitle(
  game: string,
  event: string,
  max: number,
): string | null {
  const head = `${game.trim() || GAME_FALLBACK}${POLL_TAIL}${OPEN}`;
  const whole = `${head}${event})`;
  if (points(whole).length <= max) return whole;
  const room = max - points(head).length - points(CUT_CLOSE).length;
  if (room < 1) return null;
  const cut = points(event).slice(0, room).join('').trimEnd();
  return `${head}${cut}${CUT_CLOSE}`;
}

/**
 * The poll's full thread title within `max`: the follow-up form when it
 * applies and fits, else `plain(<subject>)`, the caller's own
 * `<subject> — Poll` cut.
 */
export function pollTitleWithin(
  poll: PollTitleFields,
  max: number,
  plain: (subject: string) => string,
): string {
  const event = followupEventTitle(poll);
  const tailed =
    event === null ? null : followupPollTitle(poll.gameName, event, max);
  return tailed ?? plain(pollSubjectTitle(poll));
}
