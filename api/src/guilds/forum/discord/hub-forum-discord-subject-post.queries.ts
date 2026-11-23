/**
 * ROK-2272 S8 — the read behind any subject thread's lazy Discord post:
 * the event branch is the existing `findEventPostSource`; a poll or lineup
 * thread takes its title from the S7 subject reads.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { findLineupForSync } from '../subject-discussion/lineup-discussion.queries';
import { findPollForSync } from '../subject-discussion/poll-discussion.queries';
import { pollSubjectTitle } from '../subject-discussion/poll-discussion.sync';
import type { EventThreadWriteState } from './hub-forum-discord-event-outbound';
import {
  findEventPostSource,
  type EventPostSource,
} from './hub-forum-discord-event-outbound.queries';
import {
  pollPostTitle,
  subjectOf,
  type SubjectRef,
} from './hub-forum-discord-subject';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const threads = schema.hubForumThreads;

/** A poll or lineup thread and the title its Discord post shows. */
export interface ScheduleSubjectPostSource extends EventThreadWriteState {
  kind: 'poll' | 'lineup';
  /** The match id (poll) or lineup id. */
  id: number;
  /** The subject title, before the ` — Poll|Lineup` suffix. */
  title: string;
  /**
   * ROK-2301: the full post name when the subject composes its own (a poll:
   * the follow-up `(after <event>)` form); else `subjectPostTitle(kind, title)`.
   */
  name?: string;
  /** The S7 root text. */
  body: string;
}

/** Any subject thread's post source, discriminated on `kind`. */
export type SubjectPostSource =
  ({ kind: 'event' } & EventPostSource) | ScheduleSubjectPostSource;

/** The subject's title (+ a poll's post name); null once the row is gone. */
async function scheduleTitle(
  db: ForumDiscordDb,
  subject: SubjectRef,
): Promise<{ title: string; name?: string } | null> {
  if (subject.kind === 'poll') {
    const poll = await findPollForSync(db, subject.id);
    if (!poll) return null;
    return { title: pollSubjectTitle(poll), name: pollPostTitle(poll) };
  }
  const lineup = await findLineupForSync(db, subject.id);
  return lineup ? { title: lineup.title } : null;
}

/** The thread's subject columns, root text and write state. */
async function findSubjectThreadRow(db: ForumDiscordDb, threadId: number) {
  const [row] = await db
    .select({
      eventId: threads.eventId,
      matchId: threads.matchId,
      lineupId: threads.lineupId,
      body: threads.body,
      writeClosesAt: threads.writeClosesAt,
      eventDetachedAt: threads.eventDetachedAt,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  return row ?? null;
}

/** The subject thread `threadId` with its subject; null for a plain thread. */
export async function findSubjectPostSource(
  db: ForumDiscordDb,
  threadId: number,
): Promise<SubjectPostSource | null> {
  const row = await findSubjectThreadRow(db, threadId);
  const subject = row ? subjectOf(row) : null;
  if (!row || !subject) return null;
  if (subject.kind === 'event') {
    const src = await findEventPostSource(db, threadId);
    return src ? { kind: 'event', ...src } : null;
  }
  const titled = await scheduleTitle(db, subject);
  if (titled === null) return null;
  const { body, writeClosesAt, eventDetachedAt } = row;
  const { kind, id } = subject;
  return { kind, id, ...titled, body, writeClosesAt, eventDetachedAt };
}
