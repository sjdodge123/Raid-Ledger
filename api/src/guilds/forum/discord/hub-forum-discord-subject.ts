/**
 * ROK-2272 S8 — a forum thread's subject (event, scheduling poll or lineup)
 * as far as its Discord post goes. Pure: which subject a thread row carries
 * and the post title it gets.
 */
import { DISCORD_THREAD_NAME_MAX } from '../../../discord-bot/lfg-board/lfg-board.constants';
import { cutAtBoundary } from './hub-forum-discord-content';
import { eventPostTitle } from './hub-forum-discord-event-outbound';
import {
  pollTitleWithin,
  type PollTitleFields,
} from '../subject-discussion/poll-discussion.title';

/** What a subject thread is about. */
export type SubjectKind = 'event' | 'poll' | 'lineup';

/** A thread's subject: its kind and the subject row id. */
export interface SubjectRef {
  kind: SubjectKind;
  id: number;
}

/** The subject columns of a forum thread row. */
export interface SubjectColumns {
  eventId: number | null;
  matchId: number | null;
  lineupId: number | null;
}

/**
 * The thread's subject, or null for a plain thread. A thread carries at most
 * one; should several be set, the event wins (then the poll).
 */
export function subjectOf(t: SubjectColumns): SubjectRef | null {
  if (t.eventId !== null) return { kind: 'event', id: t.eventId };
  if (t.matchId !== null) return { kind: 'poll', id: t.matchId };
  if (t.lineupId !== null) return { kind: 'lineup', id: t.lineupId };
  return null;
}

const DASH = ' — ';

/** The post suffix (R11) and the head used when the title is empty. */
const NAMING: Record<SubjectKind, { suffix: string; fallback: string }> = {
  event: { suffix: 'Event', fallback: 'Event' },
  poll: { suffix: 'Poll', fallback: 'Scheduling' },
  lineup: { suffix: 'Lineup', fallback: 'Lineup' },
};

/**
 * The Discord post title: an event with its start ⇒ the dated
 * `eventPostTitle`; otherwise `<title> — Poll|Lineup`, ≤100 chars, a long
 * title cut at a word boundary (never the suffix), never empty.
 */
export function subjectPostTitle(
  kind: SubjectKind,
  title: string,
  start: Date | null = null,
  timeZone: string | null = null,
): string {
  if (kind === 'event' && start !== null) {
    return eventPostTitle(title, start, timeZone);
  }
  const { suffix, fallback } = NAMING[kind];
  const tail = `${DASH}${suffix}`;
  const head = cutAtBoundary(
    title.trim(),
    DISCORD_THREAD_NAME_MAX - tail.length,
  );
  return `${head.length > 0 ? head : fallback}${tail}`;
}

/**
 * ROK-2301: a poll's Discord post name, ≤100: the follow-up form
 * `<game> — Poll (after <event>)` when it applies, else
 * `subjectPostTitle('poll', <subject>)`. Same rule as the RL thread title.
 */
export function pollPostTitle(poll: PollTitleFields): string {
  const plain = (subject: string): string => subjectPostTitle('poll', subject);
  // The shared rule counts code points; this file holds Discord names to 100
  // UTF-16 units (as `cutAtBoundary` does). An emoji-heavy event title is cut
  // further until the name fits; the plain form already does. A code point
  // is at most two units, so half the overshoot never cuts more than needed.
  let max = DISCORD_THREAD_NAME_MAX;
  let name = pollTitleWithin(poll, max, plain);
  while (name.length > DISCORD_THREAD_NAME_MAX && max > 0) {
    max -= Math.ceil((name.length - DISCORD_THREAD_NAME_MAX) / 2);
    name = pollTitleWithin(poll, max, plain);
  }
  return name;
}
