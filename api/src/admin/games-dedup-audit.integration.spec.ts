/**
 * ROK-1271: integration spec for `GET /admin/games/dedup-audit`.
 *
 * Hits a real Postgres with 50 seeded games (3 dup pairs) + blast-radius
 * dep rows in events, characters, and game_interests. Asserts the
 * response shape, summary counts, and zero mutations (games row count is
 * identical before/after, no rows added to a sample dep table).
 *
 * NOT DEMO_MODE gated — the endpoint is admin-only via JWT + RolesGuard
 * and runs in any environment.
 */
import { count } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

interface AuditResponse {
  summary: {
    totalGames: number;
    totalGroups: number;
    totalDupRows: number;
  };
  groups: Array<{
    matchType: 'igdb' | 'steam' | 'name';
    matchKey: string;
    canonicalId: number;
    dupIds: number[];
  }>;
  blastRadius: Array<{
    gameId: number;
    events: number;
    characters: number;
    interests: number;
  }>;
}

/** Insert 50 games: 3 dup pairs + 44 unique. Returns the inserted ids.
 *
 * The `games.igdb_id` column has a UNIQUE constraint at the DB level
 * (see games.ts:23), so an "igdb-key dup pair" cannot exist with both
 * rows holding the same non-null igdb_id. We exercise that path purely
 * in the unit spec via mocks. Integration coverage:
 *   - pair A: steam-key match (steam_app_id is NOT unique)
 *   - pair B: name-key match (both rows have null igdb_id + null steam_app_id)
 *   - pair C: second steam-key match — gives us 3 groups total and
 *     exercises sort/grouping over multiple distinct dup keys.
 */
async function seedGames(testApp: TestApp): Promise<{
  steamDupIds: [number, number];
  nameDupIds: [number, number];
  steamDup2Ids: [number, number];
  uniqueIds: number[];
}> {
  const pairs = await testApp.db
    .insert(schema.games)
    .values([
      { name: 'Steam-Dup Game', slug: 'steam-dup-a', steamAppId: 81001 },
      { name: 'Steam-Dup Game Alt', slug: 'steam-dup-b', steamAppId: 81001 },
      { name: 'Slay the Spire 2', slug: 'name-dup-a' },
      { name: 'Slay the Spire II', slug: 'name-dup-b' },
      { name: 'Hades Game', slug: 'steam-dup-c', steamAppId: 82002 },
      { name: 'Hades Alt', slug: 'steam-dup-d', steamAppId: 82002 },
    ])
    .returning({ id: schema.games.id });

  // 44 unique games — distinct igdbId so each lands in its own bucket.
  const unique = await testApp.db
    .insert(schema.games)
    .values(
      Array.from({ length: 44 }, (_, i) => ({
        name: `Unique Game ${i}`,
        slug: `unique-${i}`,
        igdbId: 20000 + i,
      })),
    )
    .returning({ id: schema.games.id });

  return {
    steamDupIds: [pairs[0].id, pairs[1].id],
    nameDupIds: [pairs[2].id, pairs[3].id],
    steamDup2Ids: [pairs[4].id, pairs[5].id],
    uniqueIds: unique.map((r) => r.id),
  };
}

/** Seed one event + one character + one interest on each dup-pair-loser id. */
async function seedDepRowsForLoser(
  testApp: TestApp,
  loserId: number,
): Promise<void> {
  await testApp.db.insert(schema.events).values({
    title: `loser-event-${loserId}`,
    duration: [
      new Date(Date.now() + 60_000),
      new Date(Date.now() + 120_000),
    ] as [Date, Date],
    creatorId: testApp.seed.adminUser.id,
    gameId: loserId,
    maxAttendees: 10,
  });
  await testApp.db.insert(schema.characters).values({
    userId: testApp.seed.adminUser.id,
    gameId: loserId,
    name: `loser-char-${loserId}`,
  });
  await testApp.db.insert(schema.gameInterests).values({
    userId: testApp.seed.adminUser.id,
    gameId: loserId,
    source: 'manual',
  });
}

describe('GET /admin/games/dedup-audit', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await testApp.request.get('/admin/games/dedup-audit');
    expect(res.status).toBe(401);
  });

  it('returns 200 with dup groups + blast-radius counts and does NOT mutate any rows', async () => {
    const { steamDupIds, nameDupIds, steamDup2Ids } = await seedGames(testApp);

    // Attach dep rows to the NON-canonical (loser) id of each dup pair.
    // All three groups break ties on lowest id (no itadGameId / igdbId set
    // on the dup rows), so losers are the second element of each tuple.
    await seedDepRowsForLoser(testApp, steamDupIds[1]);
    await seedDepRowsForLoser(testApp, nameDupIds[1]);
    await seedDepRowsForLoser(testApp, steamDup2Ids[1]);

    // Baseline counts BEFORE the audit call.
    const [{ c: gamesBefore }] = await testApp.db
      .select({ c: count() })
      .from(schema.games);
    const [{ c: eventsBefore }] = await testApp.db
      .select({ c: count() })
      .from(schema.events);

    const res = await testApp.request
      .get('/admin/games/dedup-audit')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const body = res.body as AuditResponse;
    expect(body.summary.totalGames).toBe(Number(gamesBefore));
    expect(body.summary.totalGroups).toBe(3);
    expect(body.summary.totalDupRows).toBe(3);

    expect(body.groups).toHaveLength(3);
    const matchTypes = body.groups.map((g) => g.matchType).sort();
    expect(matchTypes).toEqual(['name', 'steam', 'steam']);

    const steamGroup = body.groups.find(
      (g) => g.matchType === 'steam' && g.matchKey === '81001',
    );
    expect(steamGroup?.canonicalId).toBe(steamDupIds[0]);
    expect(steamGroup?.dupIds).toEqual([steamDupIds[1]]);

    const steamGroup2 = body.groups.find(
      (g) => g.matchType === 'steam' && g.matchKey === '82002',
    );
    expect(steamGroup2?.canonicalId).toBe(steamDup2Ids[0]);
    expect(steamGroup2?.dupIds).toEqual([steamDup2Ids[1]]);

    const nameGroup = body.groups.find((g) => g.matchType === 'name');
    expect(nameGroup?.canonicalId).toBe(nameDupIds[0]);
    expect(nameGroup?.dupIds).toEqual([nameDupIds[1]]);

    // Blast radius: each loser has exactly 1 event + 1 character + 1
    // interest seeded by seedDepRowsForLoser.
    expect(body.blastRadius).toHaveLength(3);
    const blastByGameId = new Map(body.blastRadius.map((b) => [b.gameId, b]));
    for (const loserId of [steamDupIds[1], nameDupIds[1], steamDup2Ids[1]]) {
      const row = blastByGameId.get(loserId);
      expect(row?.events).toBe(1);
      expect(row?.characters).toBe(1);
      expect(row?.interests).toBe(1);
    }

    // No mutations: games and events row counts are unchanged.
    const [{ c: gamesAfter }] = await testApp.db
      .select({ c: count() })
      .from(schema.games);
    const [{ c: eventsAfter }] = await testApp.db
      .select({ c: count() })
      .from(schema.events);
    expect(gamesAfter).toBe(gamesBefore);
    expect(eventsAfter).toBe(eventsBefore);
  }, 60_000);

  it('returns empty groups when no duplicates exist', async () => {
    // Just the baseline-seed game from truncateAllTables — no dups.
    const res = await testApp.request
      .get('/admin/games/dedup-audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = res.body as AuditResponse;
    expect(body.summary.totalGroups).toBe(0);
    expect(body.summary.totalDupRows).toBe(0);
    expect(body.groups).toEqual([]);
    expect(body.blastRadius).toEqual([]);
  }, 60_000);
});
