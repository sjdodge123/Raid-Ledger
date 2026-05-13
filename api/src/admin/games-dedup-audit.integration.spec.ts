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
import { count, eq, sql } from 'drizzle-orm';
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

// ===========================================================================
// ROK-1270 Phase 1 — POST /admin/games/dedup-audit/run (TDD failing block).
//
// Until the dev agent ships:
//   - migration 0139 (table `games_dedup_audit` + schema export)
//   - GamesDedupAuditService.persistSnapshot()
//   - POST handler on GamesDedupAuditController
//   - 6 new BlastRadiusCounts keys + 6 new direct-count queries
//   - games-dedup-unique-conflicts.helpers.ts
//
// every test below MUST fail. Failure shapes will be one of:
//   1. 404 from POST (controller route absent)
//   2. `relation "games_dedup_audit" does not exist` (migration not run)
//   3. assertion failure on the 23-key downstream_counts shape
//   4. assertion failure on unique_conflicts contents
//   5. wrong tiebreaker selection
// All are the expected red half of TDD.
// ===========================================================================

/** Snapshot of a single persisted audit row, post-deserialize. */
interface PersistedAuditRow {
  id: number;
  match_type: 'igdb' | 'steam' | 'name';
  match_key: string;
  canonical_game_id: number;
  dup_game_ids: number[];
  group_size: number;
  downstream_counts: Record<string, number>;
  unique_conflicts: Record<string, number>;
  snapshot_at: string;
  [key: string]: unknown;
}

/** Spec response shape for the POST endpoint (matches spec §E). */
interface PersistSummary {
  snapshotAt: string;
  totalGames: number;
  totalGroups: number;
  totalDupRows: number;
  byStrategy: { igdb: number; steam: number; name: number };
  topGroups: Array<{
    canonicalGameId: number;
    matchType: 'igdb' | 'steam' | 'name';
    dupCount: number;
    downstreamRowCount: number;
    uniqueConflictCount: number;
  }>;
}

/**
 * 23-key BlastRadiusCounts JSON shape persisted to `downstream_counts`.
 * 17 existing keys (helpers.ts:73-91) + 6 new for ROK-1270.
 *
 * The dev agent MUST emit all 23 keys on every row for stability — even when
 * a particular FK has zero rows for this group. Downstream consumers (Phase 2
 * report tooling) must not have to defensively check for missing keys.
 */
const EXPECTED_BLAST_RADIUS_KEYS = [
  // 17 existing (camelCase JSON, names match helpers.ts:BlastRadiusCounts)
  'events',
  'eventPlans',
  'lineupsDecided',
  'lineupEntries',
  'lineupMatches',
  'lineupMatchMembers',
  'tiebreakers',
  'characters',
  'tasteVectors',
  'interests',
  'activityRollups',
  'activitySessions',
  'availability',
  'channelBindings',
  'discordMappings',
  'eventTypes',
  'interestSuppressions',
  // 6 new for ROK-1270 (per spec §C)
  'tiebreakerBracketGameA',
  'tiebreakerBracketGameB',
  'tiebreakerBracketWinner',
  'tiebreakerBracketVotes',
  'tiebreakerVetoes',
  'playerIntensitySnapshots',
] as const;

/** Read all persisted audit rows in deterministic order. */
async function readAuditRows(testApp: TestApp): Promise<PersistedAuditRow[]> {
  const rows = await testApp.db.execute<PersistedAuditRow>(sql`
    SELECT id, match_type, match_key, canonical_game_id, dup_game_ids,
           group_size, downstream_counts, unique_conflicts,
           snapshot_at::text AS snapshot_at
    FROM games_dedup_audit
    ORDER BY group_size DESC, canonical_game_id ASC
  `);
  return rows;
}

describe('POST /admin/games/dedup-audit/run', () => {
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

  // -------------------------------------------------------------------------
  // AC (a) — 401 on unauthenticated POST.
  // -------------------------------------------------------------------------
  it('rejects unauthenticated POSTs with 401', async () => {
    const res = await testApp.request.post('/admin/games/dedup-audit/run');
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AC (a.2) — 403 on authenticated non-admin POST.
  // The controller is class-level gated by @Roles('admin'); a valid JWT for a
  // user with role='user' must be rejected by RolesGuard with 403.
  // -------------------------------------------------------------------------
  it('rejects authenticated non-admin POSTs with 403', async () => {
    // Re-use admin's password hash so the non-admin can log in with the same
    // known password from the test seed.
    const [{ passwordHash }] = await testApp.db
      .select({ passwordHash: schema.localCredentials.passwordHash })
      .from(schema.localCredentials)
      .where(eq(schema.localCredentials.userId, testApp.seed.adminUser.id));

    const [nonAdmin] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:nonadmin@test.local',
        username: 'nonadmin',
        role: 'user',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'nonadmin@test.local',
      passwordHash,
      userId: nonAdmin.id,
    });

    const loginRes = await testApp.request.post('/auth/local').send({
      email: 'nonadmin@test.local',
      password: testApp.seed.adminPassword,
    });
    expect(loginRes.status).toBe(200);
    const nonAdminToken = (loginRes.body as { access_token: string })
      .access_token;

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${nonAdminToken}`);
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // AC (b) — 200 + PersistSummary on admin POST.
  // -------------------------------------------------------------------------
  it('returns 200 + PersistSummary for an admin caller', async () => {
    const { steamDupIds, nameDupIds, steamDup2Ids } = await seedGames(testApp);
    await seedDepRowsForLoser(testApp, steamDupIds[1]);
    await seedDepRowsForLoser(testApp, nameDupIds[1]);
    await seedDepRowsForLoser(testApp, steamDup2Ids[1]);

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const body = res.body as PersistSummary;
    expect(typeof body.snapshotAt).toBe('string');
    expect(new Date(body.snapshotAt).toString()).not.toBe('Invalid Date');
    expect(body.totalGroups).toBe(3);
    expect(body.totalDupRows).toBe(3);
    expect(body.byStrategy).toEqual({ igdb: 0, steam: 2, name: 1 });
    expect(Array.isArray(body.topGroups)).toBe(true);
    expect(body.topGroups.length).toBeGreaterThan(0);
    expect(body.topGroups.length).toBeLessThanOrEqual(10);
    expect(typeof body.topGroups[0].canonicalGameId).toBe('number');
    expect(typeof body.topGroups[0].downstreamRowCount).toBe('number');
    expect(typeof body.topGroups[0].uniqueConflictCount).toBe('number');
  }, 60_000);

  // -------------------------------------------------------------------------
  // AC (c) — After POST: persisted rows have all 23 downstream_counts keys
  //          + non-zero unique_conflicts for at least one seeded conflict.
  // -------------------------------------------------------------------------
  it('persists one row per dup group with 23-key downstream_counts and a non-zero unique_conflict', async () => {
    // Use the existing seed shape (3 dup pairs) so the GET test's mental model
    // carries over. We add a second character on canonical of the steam pair
    // (`steamDupIds[0]`) sharing the same (user_id, name, realm) tuple as the
    // dup's character — this drives a UNIQUE-constraint conflict in
    // `characters` (PK: user_id, game_id, name, realm) since merging dup →
    // canonical would collide.
    const { steamDupIds, nameDupIds, steamDup2Ids } = await seedGames(testApp);
    await seedDepRowsForLoser(testApp, steamDupIds[1]);
    await seedDepRowsForLoser(testApp, nameDupIds[1]);
    await seedDepRowsForLoser(testApp, steamDup2Ids[1]);

    // UNIQUE-conflict seed: characters row on canonical with SAME name/realm
    // as the dup's character (seedDepRowsForLoser uses `loser-char-${id}`).
    // To produce a TRUE pre-merge conflict the dup's char name must match
    // some char on the canonical id. We add one matching the canonical id.
    const dupCharName = `loser-char-${steamDupIds[1]}`;
    await testApp.db.insert(schema.characters).values({
      userId: testApp.seed.adminUser.id,
      gameId: steamDupIds[0],
      name: dupCharName,
    });

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(3);

    // All 23 keys present, all numeric, on every row.
    for (const row of rows) {
      for (const key of EXPECTED_BLAST_RADIUS_KEYS) {
        expect(row.downstream_counts).toHaveProperty(key);
        expect(typeof row.downstream_counts[key]).toBe('number');
      }
      expect(Object.keys(row.downstream_counts).sort()).toEqual(
        EXPECTED_BLAST_RADIUS_KEYS.slice().sort(),
      );
    }

    // canonical_game_id for the steam group with key '81001' is steamDupIds[0]
    // (lowest id wins — no itad/igdb set on either side).
    const steamRow = rows.find(
      (r) => r.match_type === 'steam' && r.match_key === '81001',
    );
    expect(steamRow).toBeDefined();
    expect(steamRow!.canonical_game_id).toBe(steamDupIds[0]);
    expect(steamRow!.dup_game_ids).toEqual([steamDupIds[1]]);
    expect(steamRow!.group_size).toBe(2);

    // Each loser was seeded with 1 event + 1 character + 1 interest.
    // downstream_counts sums across ALL dup ids in the group (not canonical).
    expect(steamRow!.downstream_counts.events).toBeGreaterThanOrEqual(1);
    expect(steamRow!.downstream_counts.characters).toBeGreaterThanOrEqual(1);
    expect(steamRow!.downstream_counts.interests).toBeGreaterThanOrEqual(1);

    // unique_conflicts: at least one row has a non-zero conflict count
    // (the characters seed we added above produces one).
    const totalUniqueConflicts = rows.reduce(
      (sum, r) =>
        sum + Object.values(r.unique_conflicts).reduce((a, b) => a + b, 0),
      0,
    );
    expect(totalUniqueConflicts).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // -------------------------------------------------------------------------
  // AC (d) — Idempotency: TRUNCATE+INSERT in a single tx. Second POST
  //          replaces the first; content matches modulo id + timestamps.
  // -------------------------------------------------------------------------
  it('is idempotent — calling POST twice replaces the snapshot (content matches modulo id + snapshot_at)', async () => {
    const { steamDupIds, nameDupIds } = await seedGames(testApp);
    await seedDepRowsForLoser(testApp, steamDupIds[1]);
    await seedDepRowsForLoser(testApp, nameDupIds[1]);

    const first = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(first.status).toBe(200);
    const firstRows = await readAuditRows(testApp);
    expect(firstRows.length).toBeGreaterThan(0);
    const firstSnapshotAt = (first.body as PersistSummary).snapshotAt;

    // Small delay-free second call. Same DB state — same logical content.
    const second = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(second.status).toBe(200);
    const secondRows = await readAuditRows(testApp);
    const secondSnapshotAt = (second.body as PersistSummary).snapshotAt;

    // Row count identical, second call must replace (TRUNCATE + INSERT).
    expect(secondRows).toHaveLength(firstRows.length);

    // snapshot_at differs (monotonic-or-equal — second call is later or
    // equal-to-the-millisecond, never earlier).
    expect(new Date(secondSnapshotAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstSnapshotAt).getTime(),
    );

    // For every group, the canonical/dups/strategy must match across the two
    // snapshots. We match by (match_type, match_key) since `id` is regenerated
    // by the serial on TRUNCATE+INSERT.
    const byKey = (rs: PersistedAuditRow[]) =>
      new Map(rs.map((r) => [`${r.match_type}:${r.match_key}`, r]));
    const firstByKey = byKey(firstRows);
    const secondByKey = byKey(secondRows);
    for (const [key, second] of secondByKey.entries()) {
      const first = firstByKey.get(key);
      expect(first).toBeDefined();
      expect(second.canonical_game_id).toBe(first!.canonical_game_id);
      expect(second.dup_game_ids).toEqual(first!.dup_game_ids);
      expect(second.group_size).toBe(first!.group_size);
      expect(second.downstream_counts).toEqual(first!.downstream_counts);
      expect(second.unique_conflicts).toEqual(first!.unique_conflicts);
    }

    // All rows in a single snapshot share the same snapshot_at.
    const distinctSnapshotAts = new Set(secondRows.map((r) => r.snapshot_at));
    expect(distinctSnapshotAts.size).toBe(1);
  }, 60_000);

  // -------------------------------------------------------------------------
  // AC (e) — NEW tiebreaker priority coverage.
  // Existing GET test only exercises "lowest id wins" because all seeded dups
  // have NULL itad_game_id and NULL igdb_id. This test fills that gap.
  //
  // Setup constraint: precedence bucketing (igdb → steam → name) means a row
  // with `igdb_id` set lands in its OWN igdb bucket — NOT the shared steam
  // bucket. To get 3 rows in the same bucket and vary on `itad_game_id`, we
  // seed 3 rows sharing the SAME steam_app_id, all with `igdb_id = null`,
  // and vary `itad_game_id` on one row. This validates tier 1 (itad wins
  // over min-id).
  //
  // Tier 2 (igdb beats min-id) is STRUCTURALLY UNTESTABLE at the integration
  // layer: `games.igdb_id` has a DB-level UNIQUE constraint (games.ts:23),
  // and bucketing precedence routes any row with `igdb_id` set into the
  // `igdb:` bucket. The combination means a multi-row bucket containing any
  // row with `igdb_id` set cannot exist at runtime — so tier 2 has no
  // observable behavior here. Tier 2 is covered by the unit spec at
  // games-dedup-audit.service.spec.ts via hand-crafted GameRow objects
  // that bypass DB constraints. Tier 3 (min id) is covered by the existing
  // GET test (line 135) where all seeded dups have null itad + null igdb.
  //
  // Seed: 3 rows with the SAME steam_app_id. Only row C has itad_game_id.
  //   row A: itad=null   -> not the tier-1 winner; lowest id but loses
  //   row B: itad=null   -> not the tier-1 winner
  //   row C: itad='X'    -> tier-1 winner (itad beats every lower id)
  // Expected canonical = row C's id even though rows A and B have lower ids.
  // -------------------------------------------------------------------------
  it('breaks ties by itad_game_id > igdb_id > min id (mixed-tiebreak group)', async () => {
    const inserted = await testApp.db
      .insert(schema.games)
      .values([
        // Row A: lowest id usually, but no itad — should NOT win.
        { name: 'Tier1 Game A', slug: 'tier1-a', steamAppId: 90001 },
        // Row B: second lowest id, no itad — should NOT win.
        { name: 'Tier1 Game B', slug: 'tier1-b', steamAppId: 90001 },
        // Row C: tier-1 winner (itad set). Inserted LAST so its id is highest
        // — the test proves min-id is NOT used here, the itad winner is.
        {
          name: 'Tier1 Game C',
          slug: 'tier1-c',
          steamAppId: 90001,
          itadGameId: 'itad-uuid-tier1-c',
        },
      ])
      .returning({ id: schema.games.id });
    const [rowA, rowB, rowC] = inserted;

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    const group = rows.find(
      (r) => r.match_type === 'steam' && r.match_key === '90001',
    );
    expect(group).toBeDefined();

    // Tier 1: itad_game_id wins. Row C has itad, so canonical = rowC.id even
    // though rowA.id and rowB.id are both lower.
    expect(group!.canonical_game_id).toBe(rowC.id);
    expect(group!.dup_game_ids.sort()).toEqual([rowA.id, rowB.id].sort());
    expect(group!.group_size).toBe(3);
  }, 60_000);

  // -------------------------------------------------------------------------
  // AC (f) — UNIQUE-conflict seeding for game_taste_vectors.
  // game_taste_vectors.game_id is UNIQUE. Both canonical and dup having a
  // row means merging dup → canonical in Phase 2 would violate the UNIQUE,
  // and the audit must flag that as a conflict count.
  // -------------------------------------------------------------------------
  it('counts pre-merge UNIQUE-constraint conflicts in game_taste_vectors', async () => {
    const { steamDupIds } = await seedGames(testApp);

    // Insert a game_taste_vectors row on the canonical AND on the dup.
    // pgvector accepts string-literal '[0,0,0,0,0,0,0]' cast to vector(7).
    await testApp.db.execute(sql`
      INSERT INTO game_taste_vectors (game_id, vector, dimensions, confidence, signal_hash)
      VALUES
        (${steamDupIds[0]}, '[0,0,0,0,0,0,0]'::vector(7),
         '{"dim1":0,"dim2":0,"dim3":0,"dim4":0,"dim5":0,"dim6":0,"dim7":0}'::jsonb,
         0, 'sig-canon'),
        (${steamDupIds[1]}, '[0,0,0,0,0,0,0]'::vector(7),
         '{"dim1":0,"dim2":0,"dim3":0,"dim4":0,"dim5":0,"dim6":0,"dim7":0}'::jsonb,
         0, 'sig-dup')
    `);

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    const steamRow = rows.find(
      (r) => r.match_type === 'steam' && r.match_key === '81001',
    );
    expect(steamRow).toBeDefined();
    expect(
      steamRow!.unique_conflicts.tasteVectors ??
        steamRow!.unique_conflicts.game_taste_vectors,
    ).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // -------------------------------------------------------------------------
  // AC (g) — Extra-FK coverage: seed a row in
  //          community_lineup_tiebreaker_bracket_votes for a dup id; the
  //          audit must report it in downstream_counts.tiebreakerBracketVotes.
  // -------------------------------------------------------------------------
  it('counts the 6 new FK tables in downstream_counts (tiebreakerBracketVotes example)', async () => {
    const { steamDupIds } = await seedGames(testApp);

    // Build the chain: lineup -> tiebreaker -> matchup -> vote. Each FK
    // requires its parent to exist first. We make the matchup itself game-
    // independent of our dup (game_a_id = canonical, game_b_id = canonical)
    // so the vote row is the ONLY new-FK row attached to the dup id.
    // publicSlug is varchar(16) — keep it short to satisfy the column cap.
    const slug = `tb${Date.now().toString(36).slice(-8)}`;
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Tiebreaker Lineup',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: slug,
      })
      .returning({ id: schema.communityLineups.id });

    const [tiebreaker] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId: lineup.id,
        mode: 'bracket',
        tiedGameIds: [steamDupIds[0], steamDupIds[1]],
        originalVoteCount: 0,
      })
      .returning({ id: schema.communityLineupTiebreakers.id });

    const [matchup] = await testApp.db
      .insert(schema.communityLineupTiebreakerBracketMatchups)
      .values({
        tiebreakerId: tiebreaker.id,
        round: 1,
        position: 1,
        gameAId: steamDupIds[0],
        gameBId: steamDupIds[0],
      })
      .returning({
        id: schema.communityLineupTiebreakerBracketMatchups.id,
      });

    // The actual new-FK row we care about — vote.game_id = dup id.
    await testApp.db
      .insert(schema.communityLineupTiebreakerBracketVotes)
      .values({
        matchupId: matchup.id,
        userId: testApp.seed.adminUser.id,
        gameId: steamDupIds[1], // dup id
      });

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    const steamRow = rows.find(
      (r) => r.match_type === 'steam' && r.match_key === '81001',
    );
    expect(steamRow).toBeDefined();
    expect(steamRow!.downstream_counts.tiebreakerBracketVotes).toBe(1);

    // Also assert all 6 new keys are present in the response (not just
    // tiebreakerBracketVotes).
    for (const newKey of [
      'tiebreakerBracketGameA',
      'tiebreakerBracketGameB',
      'tiebreakerBracketWinner',
      'tiebreakerBracketVotes',
      'tiebreakerVetoes',
      'playerIntensitySnapshots',
    ]) {
      expect(steamRow!.downstream_counts).toHaveProperty(newKey);
      expect(typeof steamRow!.downstream_counts[newKey]).toBe('number');
    }
  }, 60_000);
});

// ===========================================================================
// ROK-1277 — union-find connected-components grouping (TDD failing block).
//
// Production showed BG3 persisting as TWO rows because the precedence-key
// bucketing (`bucketRowsByDedupKey`) routes a row to ONE bucket only:
//   row A: igdb_id=119171, steam_app_id=NULL, name="Baldur's Gate 3"
//          → bucket `igdb:119171`
//   row B: igdb_id=NULL,    steam_app_id=1086940, name="Baldur's Gate 3"
//          → bucket `steam:1086940`
// The two rows share the normalized NAME but neither shares the precedence-
// winning key, so they land in separate single-row buckets and the audit
// misses the dup entirely.
//
// Until the dev agent ships the union-find grouping in the audit pipeline,
// every test in this block MUST fail. Expected failure shapes:
//   - The persisted snapshot has ZERO groups for these cases (current impl
//     emits single-row buckets and filters them out via `rows.length < 2`).
//   - Or the persisted snapshot routes the row to the WRONG match_type
//     (e.g. picks `igdb` when only `name` is shared).
// ===========================================================================
describe('union-find grouping (POST /admin/games/dedup-audit/run)', () => {
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

  // -------------------------------------------------------------------------
  // (a) BG3 cross-key — the exact production failure case.
  // Row A: igdb only. Row B: steam only. Both share normalized name.
  // Precedence-bucket routes A → `igdb:119171`, B → `steam:1086940` → MISS.
  // Union-find joins them via shared normalized name.
  // -------------------------------------------------------------------------
  it("BG3 cross-key: igdb-only + steam-only with shared name forms one group (match_type='name')", async () => {
    const inserted = await testApp.db
      .insert(schema.games)
      .values([
        // Row A: igdb_id set, steam_app_id null.
        {
          name: "Baldur's Gate 3",
          slug: 'bg3-igdb',
          igdbId: 119171,
        },
        // Row B: steam_app_id set, igdb_id null. Same name as A.
        {
          name: "Baldur's Gate 3",
          slug: 'bg3-steam',
          steamAppId: 1086940,
        },
      ])
      .returning({ id: schema.games.id });
    const [rowA, rowB] = inserted;

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    // Exactly one group containing both ids.
    expect(rows).toHaveLength(1);
    const group = rows[0];
    expect(group.match_type).toBe('name');
    expect(group.match_key).toMatch(/baldur.s gate 3/);
    expect(group.group_size).toBe(2);

    const idsInGroup = [group.canonical_game_id, ...group.dup_game_ids].sort();
    expect(idsInGroup).toEqual([rowA.id, rowB.id].sort());

    // The non-canonical id is reported in dup_game_ids.
    expect(group.dup_game_ids).toHaveLength(1);
    expect([rowA.id, rowB.id]).toContain(group.dup_game_ids[0]);
    expect(group.dup_game_ids[0]).not.toBe(group.canonical_game_id);
  }, 60_000);

  // -------------------------------------------------------------------------
  // (b) igdb-only + same-name name-only.
  // Row A has igdb_id + name N. Row B has only name N (no igdb, no steam).
  // Precedence-bucket routes A → `igdb:X`, B → `name:N` → MISS.
  // Union-find joins via shared normalized name. matchType=name (only
  // shared key is name).
  // -------------------------------------------------------------------------
  it("igdb-only + name-only with shared name forms one group (match_type='name')", async () => {
    const inserted = await testApp.db
      .insert(schema.games)
      .values([
        { name: 'Shared Title Alpha', slug: 'sta-igdb', igdbId: 555_001 },
        { name: 'Shared Title Alpha', slug: 'sta-noid' },
      ])
      .returning({ id: schema.games.id });
    const [rowA, rowB] = inserted;

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const group = rows[0];
    expect(group.match_type).toBe('name');
    expect(group.group_size).toBe(2);

    const idsInGroup = [group.canonical_game_id, ...group.dup_game_ids].sort();
    expect(idsInGroup).toEqual([rowA.id, rowB.id].sort());
    expect(group.dup_game_ids).toHaveLength(1);
  }, 60_000);

  // -------------------------------------------------------------------------
  // (c) steam-only + same-name name-only.
  // Row A has steam_app_id + name N. Row B has only name N.
  // Precedence-bucket routes A → `steam:Y`, B → `name:N` → MISS.
  // Union-find joins via shared normalized name. matchType=name.
  // -------------------------------------------------------------------------
  it("steam-only + name-only with shared name forms one group (match_type='name')", async () => {
    const inserted = await testApp.db
      .insert(schema.games)
      .values([
        { name: 'Shared Title Beta', slug: 'stb-steam', steamAppId: 555_002 },
        { name: 'Shared Title Beta', slug: 'stb-noid' },
      ])
      .returning({ id: schema.games.id });
    const [rowA, rowB] = inserted;

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const group = rows[0];
    expect(group.match_type).toBe('name');
    expect(group.group_size).toBe(2);

    const idsInGroup = [group.canonical_game_id, ...group.dup_game_ids].sort();
    expect(idsInGroup).toEqual([rowA.id, rowB.id].sort());
  }, 60_000);

  // -------------------------------------------------------------------------
  // (d) Transitive 3-row chain via two different shared keys.
  // A — name N + igdb X
  // B — name N + steam Y (shares name with A, shares steam with C)
  // C — name "OtherName" + steam Y (shares steam with B only)
  // A↔B connect via name; B↔C connect via steam_app_id. Union-find merges
  // all three into ONE component.
  // Note: games.igdb_id is UNIQUE at the DB level, so only B+C can share
  // steam_app_id; A's igdb_id is unique to A.
  // -------------------------------------------------------------------------
  it('forms one group for a 3-row chain connected through different shared keys (A-B by name, B-C by steam)', async () => {
    const inserted = await testApp.db
      .insert(schema.games)
      .values([
        // A: igdb + name N. Shares ONLY name with B.
        {
          name: 'Chain Title Gamma',
          slug: 'chain-a',
          igdbId: 555_003,
        },
        // B: steam + name N. Shares name with A, shares steam with C.
        {
          name: 'Chain Title Gamma',
          slug: 'chain-b',
          steamAppId: 555_004,
        },
        // C: steam (same as B's) + DIFFERENT name. Shares ONLY steam with B.
        {
          name: 'OtherName',
          slug: 'chain-c',
          steamAppId: 555_004,
        },
      ])
      .returning({ id: schema.games.id });
    const [rowA, rowB, rowC] = inserted;

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    // Exactly ONE group — A, B, C all transitively connected.
    expect(rows).toHaveLength(1);
    const group = rows[0];
    expect(group.group_size).toBe(3);

    const idsInGroup = [group.canonical_game_id, ...group.dup_game_ids].sort();
    expect(idsInGroup).toEqual([rowA.id, rowB.id, rowC.id].sort());
    expect(group.dup_game_ids).toHaveLength(2);
  }, 60_000);

  // -------------------------------------------------------------------------
  // (e) Same name + different igdb_ids — false-positive trade-off.
  //
  // Two distinct franchises can share a normalized name (e.g. two unrelated
  // games both titled "Untitled Goose Game" or franchise reboots with
  // different IGDB entries). With igdb_id set on both rows, they appear to
  // be genuinely different titles in IGDB's catalog. Even so, we group them.
  //
  // Rationale: this audit favors false positives over false negatives because
  // the operator reviews every group before Phase 2 merges anything. A false
  // positive (two unrelated games briefly flagged together) is caught and
  // dismissed by review; a false negative (the BG3-style miss) is invisible
  // and Phase 2 silently leaves the duplicate in place.
  // -------------------------------------------------------------------------
  it('groups two rows that share normalized name but have DIFFERENT igdb_ids (false-positive trade-off)', async () => {
    const inserted = await testApp.db
      .insert(schema.games)
      .values([
        { name: 'Collision Title', slug: 'coll-a', igdbId: 555_005 },
        { name: 'Collision Title', slug: 'coll-b', igdbId: 555_006 },
      ])
      .returning({ id: schema.games.id });
    const [rowA, rowB] = inserted;

    const res = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = await readAuditRows(testApp);
    // STILL ONE GROUP via shared name — audit favors false positives over
    // false negatives. Operator review catches false positives; Phase 2
    // misses false negatives entirely.
    expect(rows).toHaveLength(1);
    const group = rows[0];
    expect(group.match_type).toBe('name');
    expect(group.group_size).toBe(2);

    const idsInGroup = [group.canonical_game_id, ...group.dup_game_ids].sort();
    expect(idsInGroup).toEqual([rowA.id, rowB.id].sort());
  }, 60_000);
});
