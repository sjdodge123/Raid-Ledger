/**
 * Unit tests for users-query.helpers — fetchHeartedGames (ROK-779).
 * Verifies that hearted games query uses HEART_SOURCES allowlist
 * and excludes steam_wishlist entries.
 */
import { fetchHeartedGames } from './users-query.helpers';
import { HEART_SOURCES } from '../igdb/igdb-interest.helpers';
import { inArray } from 'drizzle-orm';

jest.mock('drizzle-orm', () => {
  const actual =
    jest.requireActual<typeof import('drizzle-orm')>('drizzle-orm');
  return { ...actual, inArray: jest.fn(actual.inArray) };
});

// ─── Mock builder ───────────────────────────────────────────────────────────

interface HeartedDbOptions {
  countRows: { count: number }[];
  dataRows: {
    id: number;
    igdbId: number | null;
    name: string;
    slug: string;
    coverUrl: string | null;
  }[];
}

function buildHeartedDb(opts: HeartedDbOptions) {
  const db: Record<string, jest.Mock> = {};
  const chain = ['select', 'from', 'innerJoin', 'orderBy'];
  for (const m of chain) {
    db[m] = jest.fn().mockReturnThis();
  }

  // First .where() call = count query (terminal)
  // Second .where() call = data query (chains to .orderBy.limit.offset)
  let whereCallCount = 0;
  db.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) {
      return Promise.resolve(opts.countRows);
    }
    return db;
  });

  db.limit = jest.fn().mockReturnThis();
  db.offset = jest.fn().mockResolvedValue(opts.dataRows);

  return db;
}

// ─── fetchHeartedGames ──────────────────────────────────────────────────────

describe('fetchHeartedGames', () => {
  it('returns hearted games with correct count', async () => {
    const db = buildHeartedDb({
      countRows: [{ count: 2 }],
      dataRows: [
        { id: 1, igdbId: 100, name: 'Game A', slug: 'game-a', coverUrl: null },
        { id: 2, igdbId: 200, name: 'Game B', slug: 'game-b', coverUrl: null },
      ],
    });

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
    });
  });

  it('returns empty result when no hearted games exist', async () => {
    const db = buildHeartedDb({
      countRows: [{ count: 0 }],
      dataRows: [],
    });

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('uses HEART_SOURCES allowlist (excludes steam_wishlist)', async () => {
    const db = buildHeartedDb({
      countRows: [{ count: 0 }],
      dataRows: [],
    });

    await fetchHeartedGames(db as never, 1, 1, 10);

    // Verify inArray was called with HEART_SOURCES
    expect(inArray).toHaveBeenCalledWith(expect.anything(), HEART_SOURCES);
    // Confirm steam_wishlist is NOT in HEART_SOURCES
    expect(HEART_SOURCES).not.toContain('steam_wishlist');
    expect(HEART_SOURCES).not.toContain('steam_library');
  });

  it('HEART_SOURCES only contains manual, discord, steam', () => {
    expect(HEART_SOURCES).toEqual(['manual', 'discord', 'steam']);
  });
});
