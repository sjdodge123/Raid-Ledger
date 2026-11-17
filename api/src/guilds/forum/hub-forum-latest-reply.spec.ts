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

const NOT_DISCORD = {
  authorDiscordId: null,
  authorDiscordName: null,
  authorDiscordAvatar: null,
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
      {
        threadId: 1,
        body: '**Count me in.** Also: Garr',
        author: MIRELLE,
        ...NOT_DISCORD,
      },
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

  it('names a Discord guest reply by its Discord author; a deleted RL user carries none (ROK-2208)', async () => {
    const guest = {
      authorDiscordId: '42',
      authorDiscordName: 'Thornwick',
      authorDiscordAvatar: 'abc',
    };
    const { db } = fakeDb([
      { threadId: 1, body: 'On my way.', author: null, ...guest },
      { threadId: 2, body: 'Gone.', author: null, ...NOT_DISCORD },
      { threadId: 3, body: 'Linked.', author: MIRELLE, ...guest },
    ]);
    const event = { lock: null };
    const [list] = await withLatestReplies(db, [
      [summary(1, event), summary(2, event), summary(3, event)],
    ]);
    expect(list?.[0]?.latestReply).toEqual({
      author: null,
      discordAuthor: {
        name: 'Thornwick',
        avatarUrl: 'https://cdn.discordapp.com/avatars/42/abc.png?size=64',
      },
      preview: 'On my way.',
    });
    expect(list?.[1]?.latestReply).toEqual({ author: null, preview: 'Gone.' });
    expect(list?.[2]?.latestReply).not.toHaveProperty('discordAuthor');
  });

  it('skips the query when the page has no live event thread', async () => {
    const { db, calls } = fakeDb([]);
    const gone = summary(4, { lock: null, deleted: 'author' });
    const [list] = await withLatestReplies(db, [[summary(5), gone]]);
    expect(calls).not.toHaveBeenCalled();
    expect(list?.map((t) => 'latestReply' in t)).toEqual([false, false]);
  });
});
