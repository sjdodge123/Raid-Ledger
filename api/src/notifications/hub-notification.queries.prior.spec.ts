/**
 * ROK-1832 (Codex r3): the late-tag backfill counts a `post_event_followup`
 * quick-sign-up DM as a prior notice for the follow-up event.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { findPriorEventNoticeUserIds } from './hub-notification.queries';

type Db = Parameters<typeof findPriorEventNoticeUserIds>[0];

describe('findPriorEventNoticeUserIds', () => {
  it('matches post_event_followup rows alongside game and group notices', async () => {
    const where = jest.fn().mockResolvedValue([{ userId: 2 }]);
    const from = jest.fn().mockReturnValue({ where });
    const db = { selectDistinct: jest.fn().mockReturnValue({ from }) };
    const ids = await findPriorEventNoticeUserIds(
      db as unknown as Db,
      9,
      [2, 3],
    );
    expect(ids).toEqual(new Set([2]));
    const [cond] = where.mock.calls[0] as [SQL];
    const { params } = new PgDialect().sqlToQuery(cond);
    expect(params).toEqual(
      expect.arrayContaining([
        'subscribed_game',
        'hub_event_tagged',
        'post_event_followup',
      ]),
    );
  });
});
