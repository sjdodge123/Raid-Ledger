/**
 * ROK-2272 S7b — `syncLineupDiscussion`, the idempotent reconciler for a
 * hub-tagged community lineup's Raid Ledger thread (the sibling of
 * `syncPollDiscussion`). Insert while the lineup is open (building/voting,
 * R4), refresh title/root and the close deadline (decided / archived ⇒
 * +1 h, R1/R2; reverted to voting ⇒ cleared), close + detach when the lineup
 * turns private, loses its hub or is gone (R6), detach-and-reinsert on a hub
 * move. A standalone poll's carrier row is never a lineup subject (§3.1).
 */
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import type { DbOrTx } from '../event-discussion/event-discussion.queries';
import type { SyncAction } from '../event-discussion/event-discussion.sync';
import {
  detachLineupThreads,
  findLineupForSync,
  findLiveLineupThread,
  type LineupSyncRow,
  type LiveLineupThread,
} from './lineup-discussion.queries';

/** A decided / archived lineup stays writable for 1 h (R1/R2). */
export const LINEUP_CLOSE_GRACE_MS = 3_600_000;
const TITLE_MAX = 120;
const SUFFIX = ' — Lineup';

/** Lineup in a closed state (decided, or archived = cancelled / done). */
function isClosed(lineup: LineupSyncRow): boolean {
  return lineup.status === 'decided' || lineup.status === 'archived';
}

/** A hub-tagged, non-private, real (non-carrier) lineup (§3.1, §3.7). */
function isEligible(lineup: LineupSyncRow | null): lineup is LineupSyncRow {
  return (
    lineup !== null &&
    lineup.guildId !== null &&
    lineup.visibility !== 'private' &&
    !lineup.standalone
  );
}

/**
 * Decision table, pure. A missing thread is only created while the lineup is
 * open: a closed lineup never gets a fresh, already-closing thread.
 */
export function planLineupSync(
  lineup: LineupSyncRow | null,
  thread: Pick<LiveLineupThread, 'guildId'> | null,
): SyncAction {
  if (!isEligible(lineup)) return thread ? 'detach' : 'noop';
  if (!thread) return isClosed(lineup) ? 'noop' : 'insert';
  return thread.guildId === lineup.guildId ? 'refresh' : 'move';
}

/** `<lineup title> — Lineup` (R11), ≤120 code points, never empty. */
export function lineupThreadTitle(title: string): string {
  const room = TITLE_MAX - Array.from(SUFFIX).length;
  const cut = Array.from(title.trim()).slice(0, room).join('').trim();
  return `${cut.length > 0 ? cut : 'Community'}${SUFFIX}`;
}

/** The generated, system-owned root post — links the lineup page. */
export function lineupThreadRootBody(lineup: LineupSyncRow): string {
  const safe = lineup.title.trim().replace(/[\\*_`[\]<>~|#]/g, '\\$&');
  const href = `/community-lineup/${lineup.lineupId}`;
  return `Community lineup **${safe}**. [Open the lineup](${href})`;
}

/**
 * Close deadline: open ⇒ none; closed ⇒ the stored one if any (the first
 * sync that saw the close stamped it), else `now + 1 h`.
 */
export function lineupWriteClosesAt(
  lineup: LineupSyncRow,
  stored: Date | null,
  now: Date,
): Date | null {
  if (!isClosed(lineup)) return null;
  return stored ?? new Date(now.getTime() + LINEUP_CLOSE_GRACE_MS);
}

/** The fields the lineup dictates on its thread. */
function derived(lineup: LineupSyncRow, stored: Date | null, now: Date) {
  return {
    title: lineupThreadTitle(lineup.title),
    body: lineupThreadRootBody(lineup),
    writeClosesAt: lineupWriteClosesAt(lineup, stored, now),
  };
}

async function insertLineupThread(
  tx: DbOrTx,
  lineup: LineupSyncRow,
  now: Date,
): Promise<void> {
  if (lineup.guildId === null) return;
  await tx
    .insert(schema.hubForumThreads)
    .values({
      guildId: lineup.guildId,
      authorId: lineup.creatorId,
      lineupId: lineup.lineupId,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      ...derived(lineup, null, now),
    })
    .onConflictDoNothing();
}

/** System refresh of an attached thread — never stamps `edited_at`. */
async function refreshLineupThread(
  tx: DbOrTx,
  thread: LiveLineupThread,
  lineup: LineupSyncRow,
  now: Date,
): Promise<void> {
  const next = derived(lineup, thread.writeClosesAt, now);
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
  lineupId: number,
  action: SyncAction,
  rows: { lineup: LineupSyncRow | null; thread: LiveLineupThread | null },
  now: Date,
): Promise<void> {
  const { lineup, thread } = rows;
  if (action === 'detach' || action === 'move') {
    await detachLineupThreads(tx, lineupId, now);
  }
  if (!lineup) return;
  if (action === 'insert' || action === 'move') {
    await insertLineupThread(tx, lineup, now);
  } else if (action === 'refresh' && thread) {
    await refreshLineupThread(tx, thread, lineup, now);
  }
}

/** Reconcile one community lineup's discussion thread. Idempotent; race-safe. */
export async function syncLineupDiscussion(
  db: Db,
  lineupId: number,
  now: Date = new Date(),
): Promise<SyncAction> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('lineup-discussion'), ${lineupId}::int)`,
    );
    const lineup = await findLineupForSync(tx, lineupId);
    const thread = await findLiveLineupThread(tx, lineupId);
    const action = planLineupSync(lineup, thread);
    await apply(tx, lineupId, action, { lineup, thread }, now);
    return action;
  });
}
