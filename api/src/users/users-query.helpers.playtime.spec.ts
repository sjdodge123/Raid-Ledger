/**
 * Adversarial tests for fetchHeartedGames — playtime edge cases (ROK-805).
 * Separate from users-query.helpers.spec.ts to stay within 750-line limit.
 *
 * Focus areas:
 * - playtimeSeconds = 0 (user has 0 minutes in steam library)
 * - playtimeSeconds conversion documented: playtimeForever * 60 → seconds
 * - Pagination offset: page 2 with limit 5 → offset 5
 * - Result shape contains all expected fields
 * - Large playtime value does not overflow (large integer)
 */
import { fetchHeartedGames, findAllUsers } from './users-query.helpers';

// ─── Shared mock builder ──────────────────────────────────────────────────────

interface HeartedRow {
  id: number;
  igdbId: number | null;
  name: string;
  slug: string;
  coverUrl: string | null;
  playtimeSeconds?: number | null;
}

function buildHeartedDb(
  countRows: { count: number }[],
  dataRows: HeartedRow[],
) {
  const db: Record<string, jest.Mock> = {};
  for (const m of ['select', 'from', 'innerJoin', 'orderBy']) {
    db[m] = jest.fn().mockReturnThis();
  }
  let whereCallCount = 0;
  db.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) return Promise.resolve(countRows);
    return db;
  });
  db.limit = jest.fn().mockReturnThis();
  db.offset = jest.fn().mockResolvedValue(dataRows);
  return db;
}

// ─── playtimeSeconds value tests ─────────────────────────────────────────────

describe('fetchHeartedGames — playtimeSeconds edge cases (ROK-805)', () => {
  it('passes through playtimeSeconds = 0 as 0 (not null)', async () => {
    const db = buildHeartedDb(
      [{ count: 1 }],
      [
        {
          id: 1,
          igdbId: 100,
          name: 'Played Nothing',
          slug: 'played-nothing',
          coverUrl: null,
          playtimeSeconds: 0,
        },
      ],
    );

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(result.data[0].playtimeSeconds).toBe(0);
  });

  it('passes through a large playtimeSeconds value without overflow', async () => {
    // 10_000 minutes * 60 = 600_000 seconds — a legitimate large value
    const db = buildHeartedDb(
      [{ count: 1 }],
      [
        {
          id: 2,
          igdbId: 200,
          name: 'Heavy Player',
          slug: 'heavy-player',
          coverUrl: null,
          playtimeSeconds: 600_000,
        },
      ],
    );

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(result.data[0].playtimeSeconds).toBe(600_000);
  });

  it('passes through playtimeSeconds = null (no steam library entry)', async () => {
    const db = buildHeartedDb(
      [{ count: 1 }],
      [
        {
          id: 3,
          igdbId: 300,
          name: 'No Steam',
          slug: 'no-steam',
          coverUrl: null,
          playtimeSeconds: null,
        },
      ],
    );

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(result.data[0].playtimeSeconds).toBeNull();
  });

  it('returns all expected fields in each data row', async () => {
    const db = buildHeartedDb(
      [{ count: 1 }],
      [
        {
          id: 7,
          igdbId: 700,
          name: 'Full Row Game',
          slug: 'full-row-game',
          coverUrl: 'https://example.com/cover.jpg',
          playtimeSeconds: 3600,
        },
      ],
    );

    const result = await fetchHeartedGames(db as never, 1, 1, 10);
    const row = result.data[0];

    expect(row).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      slug: expect.any(String),
    });
    expect('playtimeSeconds' in row).toBe(true);
  });
});

// ─── Pagination offset tests ──────────────────────────────────────────────────

describe('fetchHeartedGames — pagination', () => {
  it('passes offset=0 for page 1 limit 10', async () => {
    const db = buildHeartedDb([{ count: 5 }], []);

    await fetchHeartedGames(db as never, 1, 1, 10);

    expect(db.offset).toHaveBeenCalledWith(0);
  });

  it('passes offset=10 for page 2 limit 10', async () => {
    const db = buildHeartedDb([{ count: 20 }], []);

    await fetchHeartedGames(db as never, 1, 2, 10);

    expect(db.offset).toHaveBeenCalledWith(10);
  });

  it('passes offset=5 for page 2 limit 5', async () => {
    const db = buildHeartedDb([{ count: 12 }], []);

    await fetchHeartedGames(db as never, 1, 2, 5);

    expect(db.offset).toHaveBeenCalledWith(5);
  });

  it('passes limit to the query chain', async () => {
    const db = buildHeartedDb([{ count: 100 }], []);

    await fetchHeartedGames(db as never, 1, 1, 20);

    expect(db.limit).toHaveBeenCalledWith(20);
  });

  it('returns total as a number type (from Number() coercion)', async () => {
    // SQL count returns strings in real Postgres — Number() coerces them
    const db = buildHeartedDb([{ count: '42' as unknown as number }], []);

    const result = await fetchHeartedGames(db as never, 1, 1, 10);

    expect(typeof result.total).toBe('number');
    expect(result.total).toBe(42);
  });
});

// ─── findAllUsers — basic shape ───────────────────────────────────────────────

describe('findAllUsers — result shape', () => {
  it('returns paginated result with data and total', async () => {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['from', 'where', 'orderBy']) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.select = jest.fn().mockReturnThis();
    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) return Promise.resolve([{ count: 2 }]);
      return db;
    });
    db.limit = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockResolvedValue([
      {
        id: 1,
        username: 'Alice',
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
      },
      {
        id: 2,
        username: 'Bob',
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
      },
    ]);

    const result = await findAllUsers(db as never, 1, 10);

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it('returns total as a number even when DB returns string', async () => {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['select', 'from', 'where', 'orderBy']) {
      db[m] = jest.fn().mockReturnThis();
    }
    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1)
        return Promise.resolve([{ count: '7' as unknown as number }]);
      return db;
    });
    db.limit = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockResolvedValue([]);

    const result = await findAllUsers(db as never, 1, 10);

    expect(typeof result.total).toBe('number');
    expect(result.total).toBe(7);
  });
});
