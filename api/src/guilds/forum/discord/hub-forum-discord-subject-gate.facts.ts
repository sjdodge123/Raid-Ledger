/**
 * ROK-2272 S8 (R7, R11) — what the inbound write gate knows about one
 * (thread, Discord author): the thread's subject (event / poll / lineup),
 * its title and RL path, its read-only state, and whether the author may
 * write there. Event: a `signed_up` / `tentative` signup through the RL
 * account OR an anonymous Discord signup (OQ-10). Poll: a vote OR match
 * membership. Lineup: a nomination (carried-over ones included) OR any vote.
 * Poll and lineup count only through a linked RL account (no anonymous path).
 * The access queries are S7's — never duplicated here.
 */
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import {
  WRITABLE_SIGNUP_STATUSES,
  isEventSignup,
} from '../event-discussion/event-discussion.queries';
import {
  hasLineupNomination,
  hasLineupVote,
} from '../subject-discussion/lineup-discussion.context';
import { findLineupForSync } from '../subject-discussion/lineup-discussion.queries';
import {
  hasPollVote,
  isPollMatchMember,
} from '../subject-discussion/poll-discussion.context';
import { findPollForSync } from '../subject-discussion/poll-discussion.queries';
import { pollSubjectTitle } from '../subject-discussion/poll-discussion.sync';
import { SUBJECT_FALLBACK_TITLE } from './hub-forum-discord-subject-gate.copy';
import { userIdForDiscord } from './hub-forum-discord-inbound.writes';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

export type GateSubjectKind = 'event' | 'poll' | 'lineup';

/** The one RL subject a thread discusses. */
export interface GateSubject {
  kind: GateSubjectKind;
  id: number;
}

/** What the gate needs to know about one (thread, author). */
export interface SubjectGateFacts {
  subject: GateSubject | null;
  title: string;
  /** RL web path of the subject (`/events/7`), '' without a subject. */
  path: string;
  writeClosesAt: Date | null;
  eventDetachedAt: Date | null;
  participant: boolean;
}

/** The thread's subject from its columns (event wins; one is ever set). */
export function gateSubjectOf(t: {
  eventId: number | null;
  matchId: number | null;
  lineupId: number | null;
}): GateSubject | null {
  if (t.eventId !== null) return { kind: 'event', id: t.eventId };
  if (t.matchId !== null) return { kind: 'poll', id: t.matchId };
  if (t.lineupId !== null) return { kind: 'lineup', id: t.lineupId };
  return null;
}

/** Facts for a thread with no subject (or no row). */
const NO_SUBJECT: SubjectGateFacts = {
  subject: null,
  title: '',
  path: '',
  writeClosesAt: null,
  eventDetachedAt: null,
  participant: false,
};

type Described = Pick<SubjectGateFacts, 'title' | 'path'>;

/** Load the thread + subject facts for `authorId` (a Discord id). */
export async function loadSubjectGateFacts(
  db: ForumDiscordDb,
  threadId: number,
  authorId: string,
): Promise<SubjectGateFacts> {
  const t = schema.hubForumThreads;
  const [row] = await db
    .select({
      eventId: t.eventId,
      matchId: t.matchId,
      lineupId: t.lineupId,
      writeClosesAt: t.writeClosesAt,
      eventDetachedAt: t.eventDetachedAt,
    })
    .from(t)
    .where(eq(t.id, threadId))
    .limit(1);
  const subject = row ? gateSubjectOf(row) : null;
  if (!row || subject === null) return NO_SUBJECT;
  const [described, participant] = await Promise.all([
    describeSubject(db, subject),
    isParticipant(db, subject, authorId),
  ]);
  const { writeClosesAt, eventDetachedAt } = row;
  return { subject, ...described, writeClosesAt, eventDetachedAt, participant };
}

/** The subject's title and RL path. */
async function describeSubject(
  db: ForumDiscordDb,
  s: GateSubject,
): Promise<Described> {
  const fallback = SUBJECT_FALLBACK_TITLE[s.kind];
  if (s.kind === 'poll') {
    const poll = await findPollForSync(db, s.id);
    if (poll === null) return { title: fallback, path: '/community-lineup' };
    const path = `/community-lineup/${poll.lineupId}/schedule/${poll.matchId}`;
    return { title: pollSubjectTitle(poll), path };
  }
  if (s.kind === 'lineup') {
    const lineup = await findLineupForSync(db, s.id);
    const path = `/community-lineup/${s.id}`;
    return { title: lineup?.title ?? fallback, path };
  }
  const e = schema.events;
  const [ev] = await db
    .select({ title: e.title })
    .from(e)
    .where(eq(e.id, s.id))
    .limit(1);
  return { title: ev?.title ?? fallback, path: `/events/${s.id}` };
}

/** R7 participation for the subject's kind. */
async function isParticipant(
  db: ForumDiscordDb,
  s: GateSubject,
  authorId: string,
): Promise<boolean> {
  if (s.kind === 'event') return isSignedUp(db, s.id, authorId);
  const userId = await userIdForDiscord(db, authorId);
  if (userId === null) return false;
  if (s.kind === 'poll') {
    if (await hasPollVote(db, s.id, userId)) return true;
    return isPollMatchMember(db, s.id, userId);
  }
  if (await hasLineupNomination(db, s.id, userId)) return true;
  return hasLineupVote(db, s.id, userId);
}

/** 2226 §6 via the RL account, else OQ-10's anonymous Discord signup. */
async function isSignedUp(
  db: ForumDiscordDb,
  eventId: number,
  authorId: string,
): Promise<boolean> {
  const userId = await userIdForDiscord(db, authorId);
  if (userId !== null && (await isEventSignup(db, eventId, userId))) {
    return true;
  }
  const s = schema.eventSignups;
  const [anon] = await db
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        eq(s.eventId, eventId),
        eq(s.discordUserId, authorId),
        inArray(s.status, [...WRITABLE_SIGNUP_STATUSES]),
      ),
    )
    .limit(1);
  return anon !== undefined;
}
