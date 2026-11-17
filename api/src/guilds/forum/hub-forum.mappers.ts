/**
 * ROK-1175 L2 — row → contract mapping for forum threads and replies. Deleted
 * rows keep their DB text; every response blanks it (Q8, staff included).
 */
import type {
  HubForumCan,
  HubForumLock,
  HubForumThreadEvent,
  HubForumReply,
  HubForumThread,
  HubForumThreadSummary,
  HubPostPerson,
} from '@raid-ledger/contract';
import type {
  HubForumReplySelect,
  HubForumThreadSelect,
} from '../../drizzle/schema/hub-forum';
import { toPerson, type HubPostPersonRow } from '../posts/hub-posts.helpers';
import { forumDeleted, forumPreview } from './hub-forum.helpers';
import { eventThreadLock } from './event-discussion/event-discussion.access';

/** ROK-2226: the `events` columns an event thread is joined to. */
export interface HubForumEventRow {
  id: number;
  title: string;
  duration: [Date, Date];
  cancelledAt: Date | null;
  creatorId: number;
  /** ROK-2229: the event's capacity (null = uncapped). */
  maxAttendees?: number | null;
}

/**
 * One thread with its author's `users` columns (null once wiped) and, for an
 * event thread, its event (null once the event row is gone).
 */
export interface HubForumThreadRecord {
  thread: HubForumThreadSelect;
  author: HubPostPersonRow | null;
  event?: HubForumEventRow | null;
}

/** One reply with its author's `users` columns (null once wiped). */
export interface HubForumReplyRecord {
  reply: HubForumReplySelect;
  author: HubPostPersonRow | null;
}

/** A thread's replies page, already mapped, plus the next reply cursor. */
export interface HubForumRepliesView {
  replies: HubForumReply[];
  nextReplyCursor: string | null;
}

function forumPerson(row: HubPostPersonRow | null): HubPostPerson | null {
  return row ? toPerson(row) : null;
}

function iso(at: Date | null): string | null {
  return at ? at.toISOString() : null;
}

function toThreadEvent(row: HubForumEventRow): HubForumThreadEvent {
  return {
    id: row.id,
    title: row.title,
    startTime: row.duration[0].toISOString(),
    endTime: row.duration[1].toISOString(),
    cancelled: row.cancelledAt !== null,
    ...(row.maxAttendees === undefined
      ? {}
      : { maxAttendees: row.maxAttendees }),
  };
}

/** ROK-2226: `event` + `lock`, present on event threads only. */
function eventFields(
  record: HubForumThreadRecord,
  now: Date,
): { event?: HubForumThreadEvent | null; lock?: HubForumLock | null } {
  if (record.thread.eventId === null) return {};
  const event = record.event ?? null;
  return {
    event: event ? toThreadEvent(event) : null,
    lock: eventThreadLock(record.thread, event !== null, now),
  };
}

/** ROK-2229: folds the signup count into an event thread's `event`. */
function withSignupCount(
  summary: HubForumThreadSummary,
  signupCount: number | undefined,
): HubForumThreadSummary {
  if (signupCount === undefined || summary.event == null) return summary;
  return { ...summary, event: { ...summary.event, signupCount } };
}

/** List/widget row: title and preview blank once deleted. */
export function toThreadSummary(
  record: HubForumThreadRecord,
  now: Date = new Date(),
): HubForumThreadSummary {
  const { thread } = record;
  const deleted = thread.deletedAt ? forumDeleted(thread.deletedAs) : null;
  const live = thread.deletedAt === null;
  return {
    id: thread.id,
    title: live ? thread.title : '',
    preview: live ? forumPreview(thread.body) : '',
    author: forumPerson(record.author),
    createdAt: thread.createdAt.toISOString(),
    lastActivityAt: thread.lastActivityAt.toISOString(),
    replyCount: thread.replyCount,
    pinnedAt: iso(thread.pinnedAt),
    deleted,
    ...eventFields(record, now),
  };
}

/** One reply as the viewer sees it; body blank once deleted. */
export function toForumReply(
  record: HubForumReplyRecord,
  can: HubForumCan,
): HubForumReply {
  const { reply } = record;
  const live = reply.deletedAt === null;
  return {
    id: reply.id,
    body: live ? reply.body : '',
    author: forumPerson(record.author),
    createdAt: reply.createdAt.toISOString(),
    editedAt: iso(reply.editedAt),
    deleted: live ? null : forumDeleted(reply.deletedAs),
    can,
  };
}

/** The thread view: summary + root body + one page of replies. */
export function toForumThread(
  record: HubForumThreadRecord,
  can: HubForumCan,
  view: HubForumRepliesView & {
    now?: Date;
    canReply?: boolean;
    /** ROK-2229: the event's active signup count (event threads only). */
    signupCount?: number;
  },
): HubForumThread {
  const live = record.thread.deletedAt === null;
  const summary = toThreadSummary(record, view.now ?? new Date());
  return {
    ...withSignupCount(summary, view.signupCount),
    ...(view.canReply === undefined ? {} : { canReply: view.canReply }),
    body: live ? record.thread.body : '',
    editedAt: iso(record.thread.editedAt),
    can,
    replies: view.replies,
    nextReplyCursor: view.nextReplyCursor,
  };
}
