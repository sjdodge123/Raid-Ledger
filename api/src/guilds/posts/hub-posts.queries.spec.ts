/**
 * ROK-1868 L2 — the pure page split behind `listPosts`, plus the SQL shape
 * (`drizzle.mock()` + `toSQL()`): ORDER BY and the cursor predicate must sit
 * on the raw indexed columns so `idx_hub_posts_guild_created` serves them.
 * Paging behaviour against a real DB is the integration matrix P1/P2.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { HubPostSelect } from '../../drizzle/schema/hub-posts';
import {
  latestByGuildQuery,
  listPostsQuery,
  pageOf,
  type JoinedRow,
} from './hub-posts.queries';

const db = drizzle.mock({ schema });
const ORDER = '"hub_posts"."created_at" desc, "hub_posts"."id" desc';

function record(id: number): JoinedRow {
  const at = new Date(Date.UTC(2026, 9, 20, 12, 0, 0, id));
  const post: HubPostSelect = {
    id,
    guildId: 1,
    body: `post ${id}`,
    authorId: null,
    createdAt: at,
    updatedAt: at,
    updatedBy: null,
    relayChannelId: null,
    relayMessageId: null,
    relayedAt: null,
  };
  return { post, author: null, editor: null, cursorAt: `c${id}` };
}

describe('pageOf', () => {
  it('returns every row and no cursor when the probe is not full', () => {
    const rows = [record(3), record(2)];
    const records = rows.map(({ post, author, editor }) => ({
      post,
      author,
      editor,
    }));
    expect(pageOf(rows, 2)).toEqual({ records, next: null });
  });

  it('drops the probe row and points the cursor at the last kept row', () => {
    const rows = [record(5), record(4), record(3)];
    const page = pageOf(rows, 2);
    expect(page.records.map((r) => r.post.id)).toEqual([5, 4]);
    // The cursor carries the DB's full-precision (µs) text, not the ms Date.
    expect(page.next).toEqual({ createdAt: 'c4', id: 4 });
  });

  it('is empty with no cursor for an empty feed', () => {
    expect(pageOf([], 10)).toEqual({ records: [], next: null });
  });
});

describe('listPostsQuery SQL', () => {
  it('orders on the raw indexed columns (no date_trunc)', () => {
    const { sql } = listPostsQuery(db, 1, 10, null).toSQL();
    expect(sql).toContain(`order by ${ORDER}`);
    expect(sql).not.toMatch(/date_trunc/i);
  });

  it('pages with a row comparison on (created_at, id) and the µs cursor', () => {
    const at = '2026-10-20T12:00:00.123456Z';
    const q = listPostsQuery(db, 1, 10, { createdAt: at, id: 9 }).toSQL();
    expect(q.sql).toMatch(
      /\("hub_posts"\."created_at", "hub_posts"\."id"\) < \(\$\d+::timestamptz, \$\d+\)/,
    );
    expect(q.sql).not.toMatch(/date_trunc/i);
    expect(q.params).toEqual(expect.arrayContaining([at, 9]));
  });

  it('selects the full-precision created_at text for the next cursor', () => {
    const { sql } = listPostsQuery(db, 1, 10, null).toSQL();
    expect(sql).toContain('HH24:MI:SS.US');
  });
});

describe('latestByGuildQuery SQL', () => {
  it('orders DISTINCT ON (guild_id) by the indexed columns', () => {
    const { sql } = latestByGuildQuery(db, [1, 2]).toSQL();
    expect(sql).toContain(`order by "hub_posts"."guild_id", ${ORDER}`);
    expect(sql).not.toMatch(/date_trunc/i);
  });
});
