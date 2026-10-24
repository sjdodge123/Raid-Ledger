/**
 * ROK-1896 — poll DM hub keys. A visible tied hub yields `hubId` + `hubName`;
 * anything else yields `{}` with the keys ABSENT (not `undefined`), and a DB
 * failure never throws. Hidden vs archived is decided by the SQL predicate
 * (`visibleCommunityHubWhere`) — here both surface as "no visible row".
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  lineupHubPayload,
  matchHubPayload,
  pollBasePayload,
} from './poll-hub-payload.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const HUB_ROW = { id: 9, name: 'Tarnished Hub', gameId: 5, memberCount: 3 };

/**
 * A `select()...limit()` chain mock; each query resolves the next queued
 * row set (default `[]`). `innerJoin` is chainable for the match query.
 */
function makeDb(...rowSets: unknown[][]) {
  const limit = jest.fn().mockResolvedValue([]);
  for (const rows of rowSets) limit.mockResolvedValueOnce(rows);
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => ({ limit }));
  const select = jest.fn(() => chain);
  return { db: { select } as unknown as Db, select };
}

function makeThrowingDb(): Db {
  const select = jest.fn(() => {
    throw new Error('connection lost');
  });
  return { select } as unknown as Db;
}

describe('lineupHubPayload (ROK-1896)', () => {
  it('returns hubId + hubName for a visible tied hub', async () => {
    const { db } = makeDb([{ guildId: 9 }], [HUB_ROW]);
    await expect(lineupHubPayload(db, 42)).resolves.toEqual({
      hubId: 9,
      hubName: 'Tarnished Hub',
    });
  });

  it('omits both keys when the tied hub is hidden or archived', async () => {
    const { db } = makeDb([{ guildId: 9 }], []);
    const result = await lineupHubPayload(db, 42);
    expect(Object.keys(result)).toEqual([]);
  });

  it('omits both keys and skips the hub query for an untagged poll', async () => {
    const { db, select } = makeDb([{ guildId: null }]);
    const result = await lineupHubPayload(db, 42);
    expect(Object.keys(result)).toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('omits both keys when the lineup row is missing', async () => {
    const { db } = makeDb([]);
    expect(Object.keys(await lineupHubPayload(db, 42))).toEqual([]);
  });

  it('never throws — a DB failure yields {}', async () => {
    await expect(lineupHubPayload(makeThrowingDb(), 42)).resolves.toStrictEqual(
      {},
    );
  });
});

describe('matchHubPayload (ROK-1896)', () => {
  it('returns hubId + hubName for the match poll’s visible hub', async () => {
    const { db } = makeDb([HUB_ROW]);
    await expect(matchHubPayload(db, 100)).resolves.toEqual({
      hubId: 9,
      hubName: 'Tarnished Hub',
    });
  });

  it('omits both keys when the match poll has no visible hub', async () => {
    const { db } = makeDb([]);
    expect(Object.keys(await matchHubPayload(db, 100))).toEqual([]);
  });

  it('never throws — a DB failure yields {}', async () => {
    await expect(matchHubPayload(makeThrowingDb(), 100)).resolves.toStrictEqual(
      {},
    );
  });
});

describe('pollBasePayload (ROK-1896)', () => {
  const input = {
    lineupId: 42,
    matchId: 100,
    gameName: 'Elden Ring',
    creatorName: 'Roknua',
  };

  it('spreads the visible hub into the generic poll payload', async () => {
    const { db } = makeDb([{ guildId: 9 }], [HUB_ROW]);
    await expect(pollBasePayload(db, input)).resolves.toEqual({
      subtype: 'standalone_scheduling_poll',
      ...input,
      hubId: 9,
      hubName: 'Tarnished Hub',
    });
  });

  it('keeps the pre-ROK-1896 shape for an untagged poll', async () => {
    const { db } = makeDb([{ guildId: null }]);
    const payload = await pollBasePayload(db, { ...input, gameCoverUrl: null });
    expect(payload).toStrictEqual({
      subtype: 'standalone_scheduling_poll',
      ...input,
    });
  });
});
