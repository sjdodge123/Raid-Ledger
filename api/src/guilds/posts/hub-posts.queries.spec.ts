/**
 * ROK-1868 L2 — the pure page split behind `listPosts` (the SQL itself is
 * covered by the integration matrix P1/P2 against a real DB).
 */
import type { HubPostSelect } from '../../drizzle/schema/hub-posts';
import { pageOf, type HubPostRecord } from './hub-posts.queries';

function record(id: number): HubPostRecord {
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
  return { post, author: null, editor: null };
}

describe('pageOf', () => {
  it('returns every row and no cursor when the probe is not full', () => {
    const rows = [record(3), record(2)];
    expect(pageOf(rows, 2)).toEqual({ records: rows, next: null });
  });

  it('drops the probe row and points the cursor at the last kept row', () => {
    const rows = [record(5), record(4), record(3)];
    const page = pageOf(rows, 2);
    expect(page.records.map((r) => r.post.id)).toEqual([5, 4]);
    expect(page.next).toEqual({ createdAt: record(4).post.createdAt, id: 4 });
  });

  it('is empty with no cursor for an empty feed', () => {
    expect(pageOf([], 10)).toEqual({ records: [], next: null });
  });
});
