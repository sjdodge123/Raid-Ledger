/**
 * ROK-2272 S7a — `syncPollDiscussion`, the idempotent reconciler for a
 * hub-tagged scheduling poll's Raid Ledger thread (mirrors
 * `syncEventDiscussion`). Insert at poll open (R4), refresh title/root and
 * the close deadline (lock-in / cancel ⇒ +1 h, R1/R2; reopened ⇒ cleared),
 * close + detach when the poll turns private, loses its hub or is gone (R6),
 * detach-and-reinsert on a hub move. Never touches replies, pins or counts.
 */
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import type { DbOrTx } from '../event-discussion/event-discussion.queries';
import type { SyncAction } from '../event-discussion/event-discussion.sync';
import {
  detachPollThreads,
  findLivePollThread,
  findPollForSync,
  type LivePollThread,
  type PollSyncRow,
} from './poll-discussion.queries';

/** A decided / cancelled poll stays writable for 1 h (R1/R2). */
export const POLL_CLOSE_GRACE_MS = 3_600_000;
const TITLE_MAX = 120;
const SUFFIX = ' — Poll';

/**
 * The moment the poll ended, or null while it is open. Locked in / cancelled
 * (match row) ⇒ `now`, the first sync that sees it. Codex A: the phase job and
 * abort archive the LINEUP and leave the match on `scheduling` (same reading
 * as `pollStatusFromMatch`) ⇒ an archived lineup ends it at `now`, a passed
 * `phase_deadline` at that deadline.
 */
export function pollEndedAt(poll: PollSyncRow, now: Date): Date | null {
  if (poll.status === 'scheduled' || poll.status === 'archived') return now;
  // Parity with `pollStatusFromMatch`: a match tied to an event (a reschedule
  // poll) stays open and votable whatever happened to its lineup or deadline.
  if (poll.linkedEventId !== null) return null;
  if (poll.lineupStatus === 'archived') return now;
  const deadline = poll.phaseDeadline?.getTime();
  if (deadline !== undefined && deadline <= now.getTime()) {
    return new Date(deadline);
  }
  return null;
}

/** A hub-tagged, non-private poll that has opened (§3.1, §3.7). */
function isEligible(poll: PollSyncRow | null): poll is PollSyncRow {
  return (
    poll !== null &&
    poll.guildId !== null &&
    poll.visibility !== 'private' &&
    poll.status !== 'suggested'
  );
}

/**
 * Decision table, pure. A missing thread is only created while the poll is
 * open (`scheduling`): a closed poll never gets a fresh, already-closing thread.
 */
export function planPollSync(
  poll: PollSyncRow | null,
  thread: Pick<LivePollThread, 'guildId'> | null,
  now: Date = new Date(),
): SyncAction {
  if (!isEligible(poll)) return thread ? 'detach' : 'noop';
  if (!thread) {
    const open = poll.status === 'scheduling' && !pollEndedAt(poll, now);
    return open ? 'insert' : 'noop';
  }
  return thread.guildId === poll.guildId ? 'refresh' : 'move';
}

/** `<title> — Poll` (R11), ≤120 code points, never empty. */
export function pollThreadTitle(title: string): string {
  const room = TITLE_MAX - Array.from(SUFFIX).length;
  const cut = Array.from(title.trim()).slice(0, room).join('').trim();
  return `${cut.length > 0 ? cut : 'Scheduling'}${SUFFIX}`;
}

/** The generated, system-owned root post — links the poll page. */
export function pollThreadRootBody(poll: PollSyncRow): string {
  const safe = poll.gameName.trim().replace(/[\\*_`[\]<>~|#]/g, '\\$&');
  const href = `/community-lineup/${poll.lineupId}/schedule/${poll.matchId}`;
  return `Scheduling poll for **${safe}**. [Open the poll](${href})`;
}

/**
 * ROK-2295: the event a reschedule poll is for, or null (unlinked, gone,
 * produced by this poll at lock-in, or an empty title).
 */
export function rescheduledEvent(
  poll: Pick<PollSyncRow, 'linkedEventId' | 'linkedEventTitle'>,
): { id: number; title: string } | null {
  const title = poll.linkedEventTitle?.trim() ?? '';
  if (poll.linkedEventId === null || title.length === 0) return null;
  return { id: poll.linkedEventId, title };
}

/**
 * Close deadline: open ⇒ none; ended ⇒ the stored one if any (the first
 * sync that saw the end stamped it), else `pollEndedAt + 1 h`.
 */
export function pollWriteClosesAt(
  poll: PollSyncRow,
  stored: Date | null,
  now: Date,
): Date | null {
  const ended = pollEndedAt(poll, now);
  if (!ended) return null;
  return stored ?? new Date(ended.getTime() + POLL_CLOSE_GRACE_MS);
}

/**
 * ROK-2295: the poll's goal. A reschedule poll (linked event) ⇒
 * `Reschedule: <event title>`; any other poll ⇒ its game. A standalone poll's
 * storage lineup title is synthetic ("Standalone Scheduling Poll") and never
 * surfaces. Callers add the ` — Poll` suffix and cut to their own limit.
 */
export function pollSubjectTitle(
  poll: Pick<PollSyncRow, 'linkedEventId' | 'linkedEventTitle' | 'gameName'>,
): string {
  const event = rescheduledEvent(poll);
  return event ? `Reschedule: ${event.title}` : poll.gameName;
}

/** The fields the poll dictates on its thread. */
function derived(poll: PollSyncRow, stored: Date | null, now: Date) {
  return {
    title: pollThreadTitle(pollSubjectTitle(poll)),
    body: pollThreadRootBody(poll),
    writeClosesAt: pollWriteClosesAt(poll, stored, now),
  };
}

async function insertPollThread(
  tx: DbOrTx,
  poll: PollSyncRow,
  now: Date,
): Promise<void> {
  if (poll.guildId === null) return;
  await tx
    .insert(schema.hubForumThreads)
    .values({
      guildId: poll.guildId,
      authorId: poll.creatorId,
      matchId: poll.matchId,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      ...derived(poll, null, now),
    })
    .onConflictDoNothing();
}

/** System refresh of an attached thread — never stamps `edited_at`. */
async function refreshPollThread(
  tx: DbOrTx,
  thread: LivePollThread,
  poll: PollSyncRow,
  now: Date,
): Promise<void> {
  const next = derived(poll, thread.writeClosesAt, now);
  const same =
    thread.title === next.title &&
    thread.body === next.body &&
    thread.writeClosesAt?.getTime() === next.writeClosesAt?.getTime();
  if (same) return;
  await tx
    .update(schema.hubForumThreads)
    .set({ ...next, updatedAt: now })
    .where(eq(schema.hubForumThreads.id, thread.id));
}

async function apply(
  tx: DbOrTx,
  matchId: number,
  action: SyncAction,
  rows: { poll: PollSyncRow | null; thread: LivePollThread | null },
  now: Date,
): Promise<void> {
  const { poll, thread } = rows;
  if (action === 'detach' || action === 'move') {
    await detachPollThreads(tx, matchId, now);
  }
  if (!poll) return;
  if (action === 'insert' || action === 'move') {
    await insertPollThread(tx, poll, now);
  } else if (action === 'refresh' && thread) {
    await refreshPollThread(tx, thread, poll, now);
  }
}

/** Reconcile one scheduling poll's discussion thread. Idempotent; race-safe. */
export async function syncPollDiscussion(
  db: Db,
  matchId: number,
  now: Date = new Date(),
): Promise<SyncAction> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('poll-discussion'), ${matchId}::int)`,
    );
    const poll = await findPollForSync(tx, matchId);
    const thread = await findLivePollThread(tx, matchId);
    const action = planPollSync(poll, thread, now);
    await apply(tx, matchId, action, { poll, thread }, now);
    return action;
  });
}
