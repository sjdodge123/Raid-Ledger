import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { executeSimilarityQuery, findSimilarGames } from './similarity-queries';

/**
 * ROK-1939 Codex P2s: D9 narrowed the pvp axis, so (a) a game's or player's
 * 7-dim core vector can now be all-zero (pgvector cosine distance → NaN →
 * `similarity: null`), and (b) a game tagged only FPS/Shooter/Multiplayer no
 * longer scores on any group-play axis, so multiplayer eligibility must read
 * the game's own multiplayer metadata.
 */
const dialect = new PgDialect();

function executedQuery(mockDb: MockDb): { sql: string; params: unknown[] } {
  const call = mockDb.execute.mock.calls[0];
  if (call === undefined) throw new Error('db.execute was not called');
  const query: SQL = call[0];
  return dialect.sqlToQuery(query);
}

describe('findSimilarGames — zero-norm guard (ROK-1939)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns [] for a zero-norm target without running the similarity query', async () => {
    mockDb.limit.mockResolvedValueOnce([{ vector: [0, 0, 0, 0, 0, 0, 0] }]);
    // What pgvector would return for a zero-norm anchor if the query ran.
    mockDb.execute.mockResolvedValueOnce([
      { game_id: 9, name: 'Peer', cover_url: null, distance: 'NaN' },
    ]);

    const result = await findSimilarGames(mockDb as never, {
      gameId: 7,
      limit: 10,
    });

    expect(result).toEqual([]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('maps a NaN distance to similarity 0, never NaN/null', async () => {
    mockDb.limit.mockResolvedValueOnce([{ vector: [1, 0, 0, 0, 0, 0, 0] }]);
    mockDb.execute.mockResolvedValueOnce([
      { game_id: 9, name: 'Zero', cover_url: null, distance: 'NaN' },
    ]);

    const [row] = await findSimilarGames(mockDb as never, {
      gameId: 7,
      limit: 10,
    });

    expect(row?.similarity).toBe(0);
  });

  it('returns [] for a centroid holding NaN without running the query', async () => {
    // A shorter member vector makes the element-wise mean NaN on that axis;
    // pgvector would reject the literal outright.
    mockDb.where.mockResolvedValueOnce([
      { vector: [1, 0, 0, 0, 0, 0, 0] },
      { vector: [1, 0, 0, 0, 0, 0] },
    ]);
    mockDb.execute.mockResolvedValueOnce([
      { game_id: 9, name: 'Peer', cover_url: null, distance: '0.1' },
    ]);

    const result = await findSimilarGames(mockDb as never, {
      userIds: [1, 2],
      limit: 10,
    });

    expect(result).toEqual([]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

describe('executeSimilarityQuery — multiplayer eligibility (ROK-1939)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockDb.execute.mockResolvedValueOnce([]);
  });

  it('adds no multiplayer predicate when multiplayerOnly is false', async () => {
    await executeSimilarityQuery(
      mockDb as never,
      [1, 0, 0, 0, 0, 0, 0],
      5,
      0,
      null,
      false,
    );

    // Behaviour of each eligibility signal is covered against a real DB in
    // similar-games-zero-norm.integration.spec.ts; here only its absence.
    const { params } = executedQuery(mockDb);
    expect(params).not.toContain('multiplayer');
    expect(params).not.toContain('[2]');
  });
});
