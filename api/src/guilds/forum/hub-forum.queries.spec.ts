/**
 * ROK-1175 L2 — the pure page split, the SQL shape of the keyset reads
 * (`drizzle.mock()` + `toSQL()`), and the reply transaction's guards (a
 * fake tx). Paging and counters against a real DB are L3's integration spec.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  latestThreadsQuery,
  listRepliesQuery,
  listThreadsQuery,
  pinnedThreadsQuery,
  splitPage,
  type Db,
} from './hub-forum.queries';
import { insertReply, softDeleteReply } from './hub-forum.writes';

const db = drizzle.mock({ schema });
const T = '"hub_forum_threads"';
const R = '"hub_forum_replies"';
const CURSOR = { at: '2026-11-14T10:00:00.123456Z', id: 9 };

function probe(id: number) {
  return { record: `r${id}`, id, cursorAt: `c${id}` };
}

describe('splitPage', () => {
  it('returns every row and no cursor when the probe is not full', () => {
    expect(splitPage([probe(3), probe(2)], 2)).toEqual({
      records: ['r3', 'r2'],
      next: null,
    });
  });

  it('drops the probe row and points the cursor at the last kept row', () => {
    expect(splitPage([probe(5), probe(4), probe(3)], 2)).toEqual({
      records: ['r5', 'r4'],
      next: { at: 'c4', id: 4 },
    });
  });
});

describe('listThreadsQuery SQL', () => {
  const { sql, params } = listThreadsQuery(db, 7, 20, CURSOR).toSQL();

  it('orders by latest activity on the raw indexed columns', () => {
    expect(sql).toContain(
      `order by ${T}."last_activity_at" desc nulls last, ${T}."id" desc nulls last`,
    );
  });

  it('excludes pinned threads and lists deleted ones only with live replies', () => {
    expect(sql).toContain(`${T}."pinned_at" is null`);
    expect(sql).toContain(
      `(${T}."deleted_at" is null or ${T}."reply_count" > $`,
    );
  });

  it('pages with a row compare on (last_activity_at, id) and probes limit + 1', () => {
    expect(sql).toContain(`(${T}."last_activity_at", ${T}."id") < ($`);
    expect(params).toEqual(expect.arrayContaining([CURSOR.at, CURSOR.id, 21]));
  });

  it('selects the µs last-activity text for the next cursor', () => {
    expect(sql).toContain(`to_char(${T}."last_activity_at" AT TIME ZONE 'UTC'`);
  });
});

describe('pinnedThreadsQuery SQL', () => {
  it('keeps live pinned threads, newest pin first', () => {
    const { sql } = pinnedThreadsQuery(db, 7).toSQL();
    expect(sql).toContain(`${T}."pinned_at" is not null`);
    expect(sql).toContain(`${T}."deleted_at" is null`);
    expect(sql).toContain(`order by ${T}."pinned_at" desc nulls last`);
  });
});

describe('latestThreadsQuery SQL', () => {
  it('excludes removed threads before the limit (Codex P2)', () => {
    const { sql, params } = latestThreadsQuery(db, 7, 3).toSQL();
    const where = sql.slice(sql.indexOf(' where '), sql.indexOf(' order by '));
    expect(where).toContain(`${T}."deleted_at" is null`);
    expect(where).not.toContain(`"reply_count" > `);
    expect(sql.indexOf('limit')).toBeGreaterThan(sql.indexOf(' where '));
    expect(params).toEqual(expect.arrayContaining([7, 3]));
  });
});

describe('listRepliesQuery SQL', () => {
  it('pages oldest first after the cursor', () => {
    const { sql } = listRepliesQuery(db, 9, 20, CURSOR).toSQL();
    expect(sql).toContain(`order by ${R}."created_at", ${R}."id"`);
    expect(sql).toContain(`(${R}."created_at", ${R}."id") > ($`);
  });
});

/** A fake db whose transaction runs `fn` on a tx with canned results. */
function fakeDb(updated: unknown[]) {
  const insert = jest.fn(() => ({
    values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
  }));
  const set = jest.fn((values: Record<string, unknown>) => {
    void values;
    return { where: () => ({ returning: () => Promise.resolve(updated) }) };
  });
  const update = jest.fn(() => ({ set }));
  const tx = { insert, update };
  const fake = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { db: fake as unknown as Db, insert, update, set };
}

const TARGET = { guildId: 7, threadId: 9 };
const NOW = new Date('2026-11-14T10:00:00.000Z');

describe('insertReply', () => {
  it('writes nothing when the thread is gone or deleted (409 path)', async () => {
    const { db: fake, insert } = fakeDb([]);
    const out = await insertReply(fake, TARGET, {
      authorId: 5,
      body: 'hi',
      now: NOW,
    });
    expect(out).toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('bumps the live thread then inserts the reply', async () => {
    const { db: fake, insert } = fakeDb([{ id: 9 }]);
    const out = await insertReply(fake, TARGET, {
      authorId: 5,
      body: 'hi',
      now: NOW,
    });
    expect(out).toEqual({ id: 1 });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('never moves last activity backwards: GREATEST(stored, now)', async () => {
    const { db: fake, set } = fakeDb([{ id: 9 }]);
    await insertReply(fake, TARGET, { authorId: 5, body: 'hi', now: NOW });
    const values = set.mock.calls[0]?.[0] ?? {};
    const { sql: text, params } = db
      .update(schema.hubForumThreads)
      .set(values)
      .toSQL();
    expect(text).toMatch(
      /"last_activity_at" = GREATEST\("hub_forum_threads"\."last_activity_at", \$\d+::timestamptz\)/,
    );
    expect(params).toContain(NOW.toISOString());
  });
});

describe('softDeleteReply', () => {
  const removal = { by: 5, as: 'author' as const, now: NOW };

  it('leaves the thread counter alone when the reply was not live', async () => {
    const { db: fake, update } = fakeDb([]);
    const out = await softDeleteReply(fake, { ...TARGET, replyId: 1 }, removal);
    expect(out).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
