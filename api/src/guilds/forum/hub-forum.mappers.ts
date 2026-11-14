/**
 * ROK-1175 L2 — row → contract mapping for forum threads and replies. Deleted
 * rows keep their DB text; every response blanks it (Q8, staff included).
 */
import type {
  HubForumCan,
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

/** One thread with its author's `users` columns (null once wiped). */
export interface HubForumThreadRecord {
  thread: HubForumThreadSelect;
  author: HubPostPersonRow | null;
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

/** List/widget row: title and preview blank once deleted. */
export function toThreadSummary(
  record: HubForumThreadRecord,
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
  view: HubForumRepliesView,
): HubForumThread {
  const live = record.thread.deletedAt === null;
  return {
    ...toThreadSummary(record),
    body: live ? record.thread.body : '',
    editedAt: iso(record.thread.editedAt),
    can,
    replies: view.replies,
    nextReplyCursor: view.nextReplyCursor,
  };
}
