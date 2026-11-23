/**
 * ROK-1175 L2 — row → contract mapping for forum threads and replies. Deleted
 * rows keep their DB text; every response blanks it (Q8, staff included).
 */
import type {
  HubForumCan,
  HubForumDiscordAuthor,
  HubForumLock,
  HubForumThreadEvent,
  HubForumReply,
  HubForumSource,
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
import { resolveEventCapacity } from '../../events/signups-signup.helpers';

/** ROK-2226: the `events` columns an event thread is joined to. */
export interface HubForumEventRow {
  id: number;
  title: string;
  duration: [Date, Date];
  cancelledAt: Date | null;
  creatorId: number;
  /** ROK-2229: the legacy capacity column (null = uncapped). */
  maxAttendees?: number | null;
  /** ROK-2229: the slot roster; when set it decides capacity. */
  slotConfig?: unknown;
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

/** ROK-2208: the optional sync fields; absent on rows that never synced. */
interface ForumSyncFields {
  source?: HubForumSource;
  discordAuthor?: HubForumDiscordAuthor | null;
}

type DiscordGuestColumns = Pick<
  HubForumThreadSelect,
  'authorDiscordId' | 'authorDiscordName' | 'authorDiscordAvatar'
>;

/** Discord-origin rows say so; an unclaimed one carries its Discord author. */
export function forumSync(
  row: DiscordGuestColumns,
  author: HubPostPersonRow | null,
): ForumSyncFields {
  const { authorDiscordId: id, authorDiscordName: name } = row;
  if (id === null) return {};
  if (author !== null || name === null)
    return { source: 'discord', discordAuthor: null };
  const hash = row.authorDiscordAvatar;
  const avatarUrl = hash
    ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`
    : null;
  return { source: 'discord', discordAuthor: { name, avatarUrl } };
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
    ...threadEventCapacity(row),
  };
}

/**
 * ROK-2229: the header's "/ M" is the capacity signups are allocated against
 * (`resolveEventCapacity`: slot roster first, then maxAttendees); the event
 * page's discussion header mirrors the same rule on the web
 * (`web/src/lib/event-capacity.ts`). Omitted when the row carries neither
 * column. 0 stays 0: `isEventAtCapacity` treats it as always full, so it must
 * not read as uncapped.
 */
function threadEventCapacity(
  row: HubForumEventRow,
): Pick<HubForumThreadEvent, 'maxAttendees'> {
  if (row.maxAttendees === undefined && row.slotConfig === undefined) {
    return {};
  }
  const capacity = resolveEventCapacity({
    slotConfig: row.slotConfig ?? null,
    maxAttendees: row.maxAttendees ?? null,
  });
  return { maxAttendees: capacity };
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

/**
 * ROK-2272 S7 (Codex): a poll / lineup thread names its subject so the web
 * list's `forumRowCan` treats it as lifecycle-owned (no Edit/Delete), as the
 * thread view does. Absent on every other thread.
 */
function subjectIds(
  thread: HubForumThreadSelect,
): Pick<HubForumThreadSummary, 'matchId' | 'lineupId'> {
  return {
    ...(thread.matchId === null ? {} : { matchId: thread.matchId }),
    ...(thread.lineupId === null ? {} : { lineupId: thread.lineupId }),
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
    ...forumSync(thread, record.author),
    ...eventFields(record, now),
    ...subjectIds(thread),
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
    ...forumSync(reply, record.author),
    // ROK-2274: only a system row names its kind (absent = plain reply).
    ...(reply.kind === 'reply' ? {} : { kind: reply.kind }),
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
