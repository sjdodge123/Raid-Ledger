/**
 * ROK-2229 — event-thread list rows preview their newest live reply, fetched
 * in ONE batched query for the whole page (never one per row).
 */
import type { HubForumThreadSummary } from '@raid-ledger/contract';
import { withLatestReplies } from './hub-forum-latest-reply';
import type { Db } from './hub-forum.queries';

const AT = '2026-11-14T10:00:00.000Z';

function summary(
  id: number,
  extra: Partial<HubForumThreadSummary> = {},
): HubForumThreadSummary {
  return {
    id,
    title: `Thread ${id}`,
    preview: 'root text',
    author: null,
    createdAt: AT,
    lastActivityAt: AT,
    replyCount: 1,
    pinnedAt: null,
    deleted: null,
    ...extra,
  };
}

const MIRELLE = {
  userId: 9,
  username: 'mirelle',
  displayName: 'Mirelle',
  avatar: null,
  customAvatarUrl: null,
  discordId: null,
};

/** A db whose `selectDistinctOn(...)...orderBy()` resolves `rows`. */
function fakeDb(rows: unknown[]): { db: Db; calls: jest.Mock } {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  const calls = jest.fn(() => chain);
  return { db: { selectDistinctOn: calls } as unknown as Db, calls };
}

describe('withLatestReplies', () => {
  it('previews the newest reply of each event thread with one query', async () => {
    const { db, calls } = fakeDb([
      { threadId: 1, body: '**Count me in.** Also: Garr', author: MIRELLE },
    ]);
    const event = { lock: null };
    const [pinned, threads] = await withLatestReplies(db, [
      [summary(1, event)],
      [summary(2, event), summary(3)],
    ]);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(pinned?.[0]?.latestReply).toEqual({
      author: expect.objectContaining({ userId: 9, displayName: 'Mirelle' }),
      preview: 'Count me in. Also: Garr',
    });
    expect(threads?.[0]?.latestReply).toBeNull();
    expect(threads?.map((t) => 'latestReply' in t)).toEqual([true, false]);
  });

  it('skips the query when the page has no live event thread', async () => {
    const { db, calls } = fakeDb([]);
    const gone = summary(4, { lock: null, deleted: 'author' });
    const [list] = await withLatestReplies(db, [[summary(5), gone]]);
    expect(calls).not.toHaveBeenCalled();
    expect(list?.map((t) => 'latestReply' in t)).toEqual([false, false]);
  });
});
