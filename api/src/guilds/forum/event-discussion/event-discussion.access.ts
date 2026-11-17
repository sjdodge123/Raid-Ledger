/**
 * ROK-2226 §6 — who may do what in an EVENT thread (pure; no DB). Read =
 * hub member/staff, a current signup (ruling 11: that thread only) or the
 * event creator (ruling 13). Reply = a current signup only (ruling 2:
 * tentative counts; ruling 12: Leaders/Officers/admins too). Moderate =
 * hub Leader/Officer/staff, signed up or not. Read-only state (§5.4) and the
 * refusals of §12 live here as well.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { HubForumLock } from '@raid-ledger/contract';
import type { HubForumActor, HubForumOwnedRow } from '../hub-forum.helpers';

/** §12: reply without a writable signup. */
export const FORUM_NOT_SIGNED_UP =
  'Sign up for the event to join its discussion';
/** §12: reply (409) or edit (403) once the thread is read-only. */
export const FORUM_THREAD_READ_ONLY = 'This discussion is read-only';
/** §5.5: PATCH/DELETE of an event thread itself. */
export const FORUM_EVENT_THREAD_MANAGED = 'This thread belongs to an event';

/** What the service resolved about the viewer for one event thread. */
export interface EventThreadFacts {
  /** `access.canView` on the thread's hub (members + staff). */
  isMember: boolean;
  /** `access.canEdit` on the thread's hub (Leader/Officer + staff). */
  canModerate: boolean;
  /** A `signed_up`/`tentative` row on the ATTACHED event. */
  isSignedUp: boolean;
  /** `events.creator_id` of the ATTACHED event. */
  isCreator: boolean;
}

/** The forum actor plus the two event-only rights. */
export interface EventThreadActor extends HubForumActor {
  canRead: boolean;
  canReply: boolean;
}

/**
 * §6 matrix → actor. `canWrite` (own-row rights: delete own) stays with
 * members and signups; editing also needs `canReply` (the current write
 * right), which the service passes to `canFor` as `readOnly`.
 */
export function eventThreadActor(
  userId: number,
  facts: EventThreadFacts,
): EventThreadActor {
  const { isMember, isSignedUp, isCreator } = facts;
  return {
    userId,
    canRead: isMember || isSignedUp || isCreator,
    canReply: isSignedUp,
    canWrite: isMember || isSignedUp,
    canModerate: isMember && facts.canModerate,
  };
}

/** The thread columns the read-only state is derived from. */
export interface EventThreadLockRow {
  eventId: number | null;
  eventDetachedAt: Date | null;
  writeClosesAt: Date | null;
}

/**
 * §5.4 read-only state, or null while writable / for a normal thread. A
 * missing event row reads as deleted even if no listener detached it (D1).
 */
export function eventThreadLock(
  row: EventThreadLockRow,
  eventExists: boolean,
  now: Date,
): HubForumLock | null {
  if (row.eventId === null) return null;
  if (!eventExists) {
    const at = row.eventDetachedAt ?? row.writeClosesAt ?? now;
    return { at: at.toISOString(), reason: 'event-deleted' };
  }
  if (row.eventDetachedAt !== null) {
    return { at: row.eventDetachedAt.toISOString(), reason: 'event-detached' };
  }
  const closes = row.writeClosesAt;
  if (closes !== null && now.getTime() >= closes.getTime()) {
    return { at: closes.toISOString(), reason: 'event-ended' };
  }
  return null;
}

/** §5.5: the thread itself is lifecycle-owned (nobody edits or removes it). */
export function assertNotEventThread(thread: { eventId: number | null }): void {
  if (thread.eventId !== null) {
    throw new ForbiddenException(FORUM_EVENT_THREAD_MANAGED);
  }
}

/**
 * Reply gate: 409 once read-only (§12 — ended OR detached, for everyone; a
 * detached thread no longer counts anyone's signup, so the lock must win or a
 * signed-up member would read "sign up"), else 403 without a writable signup.
 */
export function assertCanReply(
  canReply: boolean,
  lock: HubForumLock | null,
): void {
  if (lock !== null) throw new ConflictException(FORUM_THREAD_READ_ONLY);
  if (!canReply) throw new ForbiddenException(FORUM_NOT_SIGNED_UP);
}

/**
 * Edit refusals specific to event threads, for the viewer's OWN live row:
 * read-only first (403), then a lapsed signup (403). Everything else falls
 * through to the generic `assertCanEdit`.
 */
export function assertEventEditable(
  who: { userId: number; canReply: boolean },
  row: HubForumOwnedRow,
  lock: HubForumLock | null,
): void {
  if (row.authorId !== who.userId || row.deletedAt !== null) return;
  if (lock !== null) throw new ForbiddenException(FORUM_THREAD_READ_ONLY);
  if (!who.canReply) throw new ForbiddenException(FORUM_NOT_SIGNED_UP);
}
