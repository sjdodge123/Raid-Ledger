/**
 * ROK-2272 S8 — the poll-deadline pass (unit): per-poll error isolation and
 * the synced count. The candidate query itself is covered by
 * `poll-discussion.deadline.integration.spec.ts`.
 */
import type { Db } from '../hub-forum.queries';
import { syncExpiredPolls } from './poll-discussion.deadline';
import { syncPollDiscussion } from './poll-discussion.sync';

jest.mock('./poll-discussion.sync', () => ({
  syncPollDiscussion: jest.fn(),
}));
const sync = jest.mocked(syncPollDiscussion);

const NOW = new Date('2026-11-20T12:00:00Z');

/** A db whose candidate select resolves to `ids`. */
function fakeDb(ids: number[]): Db {
  const rows = ids.map((matchId) => ({ matchId }));
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

beforeEach(() => sync.mockReset());

describe('syncExpiredPolls', () => {
  it('re-syncs every candidate with the same now and counts them', async () => {
    sync.mockResolvedValue('refresh');
    const db = fakeDb([4, 9]);
    expect(await syncExpiredPolls(db, NOW)).toBe(2);
    expect(sync.mock.calls).toEqual([
      [db, 4, NOW],
      [db, 9, NOW],
    ]);
  });

  it('one failing poll is skipped; the rest still sync', async () => {
    sync.mockRejectedValueOnce(new Error('lock timeout'));
    sync.mockResolvedValue('refresh');
    expect(await syncExpiredPolls(fakeDb([4, 9, 11]), NOW)).toBe(2);
    expect(sync.mock.calls.map((c) => c[1])).toEqual([4, 9, 11]);
  });

  it('no candidates ⇒ 0, no sync', async () => {
    expect(await syncExpiredPolls(fakeDb([]), NOW)).toBe(0);
    expect(sync).not.toHaveBeenCalled();
  });
});
