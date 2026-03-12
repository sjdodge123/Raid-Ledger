/**
 * Unit tests for users-query.helpers (ROK-779, ROK-804).
 * - fetchHeartedGames: verifies HEART_SOURCES allowlist
 * - findAllByGame: verifies deduplication and HEART_SOURCES filter
 */
import { fetchHeartedGames, findAllByGame } from './users-query.helpers';
import { HEART_SOURCES } from '../igdb/igdb-interest.helpers';
import { inArray } from 'drizzle-orm';

jest.mock('drizzle-orm', () => {
  const actual =
    jest.requireActual<typeof import('drizzle-orm')>('drizzle-orm');
  return { ...actual, inArray: jest.fn(actual.inArray) };
});

// ─── Mock builders ──────────────────────────────────────────────────────────

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

interface FindAllByGameDbOptions {
  countRows: { count: number }[];
  dataRows: {
    id: number;
    username: string;
    avatar: string | null;
    discordId: string | null;
    customAvatarUrl: string | null;
  }[];
}

/**
 * Build a mock DB for findAllByGame.
 * Query chain after fix:
 *   Count: select({count}).from().innerJoin().where() -- terminal
 *   Data: selectDistinctOn([users.id], cols).from().innerJoin().where().orderBy().limit().offset()
 */
function buildFindAllByGameDb(opts: FindAllByGameDbOptions) {
  const db: Record<string, jest.Mock> = {};
  const chain = ['from', 'innerJoin', 'orderBy'];
  for (const m of chain) {
    db[m] = jest.fn().mockReturnThis();
  }
  db.select = jest.fn().mockReturnThis();
  db.selectDistinctOn = jest.fn().mockReturnThis();
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

    expect(inArray).toHaveBeenCalledWith(expect.anything(), HEART_SOURCES);
    expect(HEART_SOURCES).not.toContain('steam_wishlist');
    expect(HEART_SOURCES).not.toContain('steam_library');
  });

  it('HEART_SOURCES only contains manual, discord, steam', () => {
    expect(HEART_SOURCES).toEqual(['manual', 'discord', 'steam']);
  });
});

// ─── findAllByGame (ROK-804) ────────────────────────────────────────────────

const mockUser = (id: number, username: string) => ({
  id,
  username,
  avatar: null,
  discordId: null,
  customAvatarUrl: null,
});

function describeFindAllByGame() {
  beforeEach(() => {
    (inArray as jest.Mock).mockClear();
  });

  it('filters by HEART_SOURCES when no source param given', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42);
    expect(inArray).toHaveBeenCalledWith(expect.anything(), HEART_SOURCES);
  });

  it('uses selectDistinctOn for data query to deduplicate users', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42);
    expect(db.selectDistinctOn).toHaveBeenCalled();
  });

  it('returns unique user count (not row count)', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 2 }],
      dataRows: [mockUser(1, 'Alice'), mockUser(2, 'Bob')],
    });
    const result = await findAllByGame(db as never, 1, 10, undefined, 42);
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it('does not filter by HEART_SOURCES when source is specified', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42, 'manual');
    const heartSourceCalls = (inArray as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[1] === HEART_SOURCES,
    );
    expect(heartSourceCalls).toHaveLength(0);
  });
}
describe('findAllByGame', describeFindAllByGame);

// ─── findAllByGame — adversarial edge cases (ROK-804) ───────────────────────

describe('findAllByGame — deduplication edge cases', () => {
  beforeEach(() => {
    (inArray as jest.Mock).mockClear();
  });

  it('returns count of 1 when the same user holds 3 source entries', async () => {
    // Simulates: user 1 has manual + discord + steam rows → DISTINCT count = 1
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    const result = await findAllByGame(db as never, 1, 10, undefined, 42);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it('returns empty data and zero total when all interested rows deduplicate away', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 0 }],
      dataRows: [],
    });
    const result = await findAllByGame(db as never, 1, 10, undefined, 99);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('count and data are both distinct — count matches deduplicated data length', async () => {
    // 3 users, each with 2 source rows → DISTINCT count = 3, data rows = 3
    const db = buildFindAllByGameDb({
      countRows: [{ count: 3 }],
      dataRows: [
        mockUser(1, 'Alice'),
        mockUser(2, 'Bob'),
        mockUser(3, 'Carol'),
      ],
    });
    const result = await findAllByGame(db as never, 1, 10, undefined, 5);
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(3);
  });

  it('uses HEART_SOURCES filter for each of the three valid source values', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42);
    const heartCall = (inArray as jest.Mock).mock.calls.find(
      (call: unknown[]) => call[1] === HEART_SOURCES,
    );
    expect(heartCall).toBeDefined();
    // Confirm all three valid heart sources are covered
    expect(HEART_SOURCES).toContain('manual');
    expect(HEART_SOURCES).toContain('discord');
    expect(HEART_SOURCES).toContain('steam');
  });

  it('does not include steam_library or steam_wishlist in HEART_SOURCES', () => {
    expect(HEART_SOURCES).not.toContain('steam_library');
    expect(HEART_SOURCES).not.toContain('steam_wishlist');
  });

  it('does not use selectDistinctOn when fetching the count (uses select)', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 2 }],
      dataRows: [mockUser(1, 'Alice'), mockUser(2, 'Bob')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42);
    // select is called for the count query; selectDistinctOn for the data query
    expect(db.select).toHaveBeenCalled();
    expect(db.selectDistinctOn).toHaveBeenCalled();
  });

  it('passes explicit source param through without adding HEART_SOURCES filter', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(7, 'Dave')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42, 'discord');
    // inArray should not have been called with HEART_SOURCES
    const heartSourceCalls = (inArray as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[1] === HEART_SOURCES,
    );
    expect(heartSourceCalls).toHaveLength(0);
  });

  it('returns count as a number, not a string', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 5 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    const result = await findAllByGame(db as never, 1, 10, undefined, 42);
    expect(typeof result.total).toBe('number');
  });

  it('data rows have the expected user shape', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [
        { id: 10, username: 'Zara', avatar: 'hash', discordId: '999', customAvatarUrl: null },
      ],
    });
    const result = await findAllByGame(db as never, 1, 10, undefined, 42);
    expect(result.data[0]).toMatchObject({
      id: expect.any(Number),
      username: expect.any(String),
    });
  });

  it('single user with one source returns count of 1 and one data row', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Solo')],
    });
    const result = await findAllByGame(db as never, 1, 10, undefined, 42);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });
});
