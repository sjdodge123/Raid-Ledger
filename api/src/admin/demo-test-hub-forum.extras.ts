/**
 * ROK-1175 — the fleet test plan's forum extras (`full: true` on the seed):
 * a second pin (newer, so it lists first), a thread deleted by its author
 * that keeps a live reply (the removed-thread placeholder), and the member
 * thread grown to 30 replies with one deleted by its author.
 */
import {
  insertSeedReplies,
  insertSeedThread,
  type SeedActors,
  type SeedDb,
} from './demo-test-hub-forum.rows';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Replies the long thread ends with: 2 base + 1 author-deleted + 27 filler. */
export const LONG_THREAD_REPLIES = 30;

/** Ids the test plan's `test_url`s point at. */
export interface HubForumSeedExtras {
  /** Newest pin first, as the list orders them. */
  pinnedThreadIds: [number, number];
  removedThreadId: number;
  authorDeletedReplyId: number;
  longThreadId: number;
}

async function removedThread(db: SeedDb, a: SeedActors, now: Date) {
  const at = new Date(now.getTime() - 5 * HOUR_MS);
  const id = await insertSeedThread(db, a, {
    authorId: a.memberId,
    title: 'Selling my old mount (deleted)',
    body: 'Never mind.',
    at,
    deleted: { by: a.memberId, as: 'author' },
  });
  await insertSeedReplies(db, a, id, [
    { authorId: a.leaderId, body: 'Too late, I wanted it!', at },
  ]);
  return id;
}

/** 28 more replies on the long thread: one author-deleted, 27 filler. */
async function longThread(
  db: SeedDb,
  a: SeedActors,
  threadId: number,
  now: Date,
): Promise<number> {
  const at = (i: number) =>
    new Date(now.getTime() - 25 * MINUTE_MS + i * (MINUTE_MS / 2));
  const [deleted] = await insertSeedReplies(db, a, threadId, [
    {
      authorId: a.memberId,
      body: 'Wrong thread, sorry',
      at: at(0),
      deleted: { by: a.memberId, as: 'author' },
    },
  ]);
  if (deleted === undefined) throw new Error('forum seed: reply missing');
  const filler = Array.from({ length: LONG_THREAD_REPLIES - 3 }, (_, i) => ({
    authorId: i % 2 === 0 ? a.leaderId : a.memberId,
    body: `Filler reply ${i + 1}`,
    at: at(i + 1),
  }));
  await insertSeedReplies(db, a, threadId, filler);
  return deleted;
}

export async function seedFullExtras(
  db: SeedDb,
  a: SeedActors,
  base: { pinnedThreadId: number; memberThreadId: number },
  now: Date,
): Promise<HubForumSeedExtras> {
  const secondPin = await insertSeedThread(db, a, {
    authorId: a.leaderId,
    title: 'Raid schedule',
    body: 'Tuesdays and Thursdays, 8pm server time.',
    at: new Date(now.getTime() - 2 * HOUR_MS),
    pinned: true,
  });
  const removedThreadId = await removedThread(db, a, now);
  const longThreadId = base.memberThreadId;
  const authorDeletedReplyId = await longThread(db, a, longThreadId, now);
  return {
    pinnedThreadIds: [secondPin, base.pinnedThreadId],
    removedThreadId,
    authorDeletedReplyId,
    longThreadId,
  };
}
