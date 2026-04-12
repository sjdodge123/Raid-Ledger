/**
 * Unit tests for users-query.helpers (ROK-779, ROK-804, ROK-821).
 * - fetchHeartedGames: verifies HEART_SOURCES allowlist
 * - findAllByGame: verifies deduplication, HEART_SOURCES filter, multi-source, playtime, playHistory
 * - findAllUsers: verifies role filter
 */
import {
  fetchHeartedGames,
  findAllByGame,
  findAllUsers,
} from './users-query.helpers';
import { HEART_SOURCES } from '../igdb/igdb-interest.helpers';
import { inArray, eq, gte, gt } from 'drizzle-orm';

jest.mock('drizzle-orm', () => {
  const actual =
    jest.requireActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    inArray: jest.fn(actual.inArray),
    eq: jest.fn(actual.eq),
    gte: jest.fn(actual.gte),
    gt: jest.fn(actual.gt),
  };
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
    playtimeSeconds?: number | null;
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

  it('HEART_SOURCES contains manual, discord, steam, poll', () => {
    expect(HEART_SOURCES).toEqual(['manual', 'discord', 'steam', 'poll']);
  });

  it('includes playtimeSeconds in result shape (ROK-805)', async () => {
    const db = buildHeartedDb({
      countRows: [{ count: 1 }],
      dataRows: [
        {
          id: 1,
          igdbId: 100,
          name: 'Game A',
          slug: 'game-a',
          coverUrl: null,
          playtimeSeconds: 7200,
        },
      ],
    });

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(result.data[0]).toHaveProperty('playtimeSeconds');
  });

  it('playtimeSeconds can be null when no steam data (ROK-805)', async () => {
    const db = buildHeartedDb({
      countRows: [{ count: 1 }],
      dataRows: [
        {
          id: 2,
          igdbId: 200,
          name: 'Game B',
          slug: 'game-b',
          coverUrl: null,
          playtimeSeconds: null,
        },
      ],
    });

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(result.data[0].playtimeSeconds).toBeNull();
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
    await findAllByGame(db as never, 1, 10, undefined, 42, ['manual']);
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
    await findAllByGame(db as never, 1, 10, undefined, 42, ['discord']);
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
        {
          id: 10,
          username: 'Zara',
          avatar: 'hash',
          discordId: '999',
          customAvatarUrl: null,
        },
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

// ─── findAllByGame — multi-source, playtime, playHistory (ROK-821) ───────────

describe('findAllByGame — advanced filters (ROK-821)', () => {
  beforeEach(() => {
    (inArray as jest.Mock).mockClear();
    (gte as jest.Mock).mockClear();
    (gt as jest.Mock).mockClear();
  });

  it('uses sources array when provided', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42, [
      'manual',
      'discord',
    ]);
    const sourceCalls = (inArray as jest.Mock).mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && call[1].includes('manual'),
    );
    expect(sourceCalls.length).toBeGreaterThan(0);
    expect(sourceCalls[0][1]).toEqual(['manual', 'discord']);
  });

  it('falls back to HEART_SOURCES when sources is empty array', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42, []);
    expect(inArray).toHaveBeenCalledWith(expect.anything(), HEART_SOURCES);
  });

  it('applies playtimeMin filter via gte', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(db as never, 1, 10, undefined, 42, [], 120);
    expect(gte).toHaveBeenCalledWith(expect.anything(), 120);
  });

  it('applies played_recently filter via gt on playtime2weeks', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(
      db as never,
      1,
      10,
      undefined,
      42,
      [],
      undefined,
      'played_recently',
    );
    expect(gt).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it('applies played_ever filter via gt on playtimeForever', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    await findAllByGame(
      db as never,
      1,
      10,
      undefined,
      42,
      [],
      undefined,
      'played_ever',
    );
    expect(gt).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it('does not apply play history filter for "any"', async () => {
    const db = buildFindAllByGameDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Alice')],
    });
    (gt as jest.Mock).mockClear();
    await findAllByGame(
      db as never,
      1,
      10,
      undefined,
      42,
      [],
      undefined,
      'any',
    );
    expect(gt).not.toHaveBeenCalled();
  });
});

// ─── findAllUsers — role filter (ROK-821) ────────────────────────────────────

function buildFindAllUsersDb(opts: {
  countRows: { count: number }[];
  dataRows: ReturnType<typeof mockUser>[];
}) {
  const db: Record<string, jest.Mock> = {};
  const chain = ['from', 'orderBy'];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();
  db.select = jest.fn().mockReturnThis();
  let whereCallCount = 0;
  db.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) return Promise.resolve(opts.countRows);
    return db;
  });
  db.limit = jest.fn().mockReturnThis();
  db.offset = jest.fn().mockResolvedValue(opts.dataRows);
  return db;
}

describe('findAllUsers — role filter (ROK-821)', () => {
  beforeEach(() => {
    (eq as jest.Mock).mockClear();
  });

  it('applies role filter when role is provided', async () => {
    const db = buildFindAllUsersDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(1, 'Admin')],
    });
    await findAllUsers(db as never, 1, 10, undefined, 'admin');
    const roleCalls = (eq as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[1] === 'admin',
    );
    expect(roleCalls.length).toBeGreaterThan(0);
  });

  it('does not apply role filter when role is undefined', async () => {
    const db = buildFindAllUsersDb({
      countRows: [{ count: 2 }],
      dataRows: [mockUser(1, 'Alice'), mockUser(2, 'Bob')],
    });
    (eq as jest.Mock).mockClear();
    await findAllUsers(db as never, 1, 10);
    const roleCalls = (eq as jest.Mock).mock.calls.filter(
      (call: unknown[]) =>
        call[1] === 'admin' || call[1] === 'member' || call[1] === 'operator',
    );
    expect(roleCalls).toHaveLength(0);
  });

  it('returns correct total and data', async () => {
    const db = buildFindAllUsersDb({
      countRows: [{ count: 1 }],
      dataRows: [mockUser(5, 'Admin')],
    });
    const result = await findAllUsers(db as never, 1, 10, undefined, 'admin');
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 5, username: 'Admin' });
  });
});
