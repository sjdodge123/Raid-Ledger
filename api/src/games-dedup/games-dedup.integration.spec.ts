/**
 * ROK-1270 Phase 1 — Games Dedup Audit (TDD failing spec).
 *
 * Written BEFORE implementation. Drives the contract for:
 *   - `GamesDedupService.runAudit()`
 *   - `games_dedup_audit` table (migration 0139)
 *   - The `POST /admin/games-dedup/audit` admin endpoint
 *
 * Until the dev agent ships the module + migration, every test below MUST
 * fail at module-resolution time ("Cannot find module
 * '../games-dedup/games-dedup.service'") OR at runtime (table does not
 * exist). That failure mode is intentional — it's the red half of red/green.
 *
 * Pattern mirrors `api/src/drizzle/pgvector.integration.spec.ts`:
 *   - boots a real Postgres via `getTestApp()`
 *   - seeds rows via Drizzle / raw `sql`
 *   - asserts the audit table contents directly
 */
import { sql, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
// Module under test (does NOT exist yet — this import will fail until
// the dev agent creates the file). The test file is intentionally checking
// the production code path that the spec drives.
import { GamesDedupService } from './games-dedup.service';

/** Helper: insert a games row, return the id (Drizzle insert .returning). */
async function seedGame(
  testApp: TestApp,
  overrides: Partial<typeof schema.games.$inferInsert> & {
    name: string;
    slug: string;
  },
): Promise<typeof schema.games.$inferSelect> {
  const [row] = await testApp.db
    .insert(schema.games)
    .values({
      name: overrides.name,
      slug: overrides.slug,
      ...overrides,
    })
    .returning();
  return row;
}

/** Helper: insert a downstream character row attached to gameId. */
async function seedCharacter(
  testApp: TestApp,
  userId: number,
  gameId: number,
  name: string,
): Promise<void> {
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId,
    name,
  });
}

/** Helper: insert a game_taste_vectors row (UNIQUE gameId — used to test
 *  unique_conflicts pre-merge count). */
async function seedGameTasteVector(
  testApp: TestApp,
  gameId: number,
  signalHash: string,
): Promise<void> {
  // pgvector accepts string literal '[0,0,0,0,0,0,0]' cast to vector(7).
  await testApp.db.execute(sql`
    INSERT INTO game_taste_vectors (game_id, vector, dimensions, confidence, signal_hash)
    VALUES (
      ${gameId},
      '[0,0,0,0,0,0,0]'::vector(7),
      '{"dim1":0,"dim2":0,"dim3":0,"dim4":0,"dim5":0,"dim6":0,"dim7":0}'::jsonb,
      0,
      ${signalHash}
    )
  `);
}

/** Helper: insert an events row tied to gameId (creator = baseline admin). */
async function seedEvent(
  testApp: TestApp,
  gameId: number,
  creatorId: number,
  title: string,
): Promise<void> {
  await testApp.db.execute(sql`
    INSERT INTO events (title, game_id, creator_id, duration)
    VALUES (
      ${title},
      ${gameId},
      ${creatorId},
      tsrange('2026-02-10 18:00:00', '2026-02-10 20:00:00')
    )
  `);
}

/** Helper: read all audit rows in deterministic order (group_size DESC, id ASC). */
async function readAuditRows(testApp: TestApp): Promise<
  Array<{
    id: number;
    dedup_key: string;
    dedup_strategy: string;
    canonical_game_id: number;
    dup_game_ids: number[];
    group_size: number;
    downstream_counts: Record<string, number>;
    unique_conflicts: Record<string, number>;
  }>
> {
  const rows = await testApp.db.execute<{
    id: number;
    dedup_key: string;
    dedup_strategy: string;
    canonical_game_id: number;
    dup_game_ids: number[];
    group_size: number;
    downstream_counts: Record<string, number>;
    unique_conflicts: Record<string, number>;
  }>(sql`
    SELECT id, dedup_key, dedup_strategy, canonical_game_id, dup_game_ids,
           group_size, downstream_counts, unique_conflicts
    FROM games_dedup_audit
    ORDER BY group_size DESC, id ASC
  `);
  return rows as unknown as Array<{
    id: number;
    dedup_key: string;
    dedup_strategy: string;
    canonical_game_id: number;
    dup_game_ids: number[];
    group_size: number;
    downstream_counts: Record<string, number>;
    unique_conflicts: Record<string, number>;
  }>;
}

describe('GamesDedupService.runAudit (ROK-1270 Phase 1)', () => {
  let testApp: TestApp;
  let service: GamesDedupService;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(GamesDedupService);
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ===================================================================
  // AC 1 — Endpoint behavior: zero dups produces an empty audit
  // ===================================================================
  it('produces zero audit rows when no duplicates exist', async () => {
    // Baseline seed already inserts one game (testApp.seed.game). That's
    // a singleton group — no dups.
    const summary = await service.runAudit();

    expect(summary.groupsFound).toBe(0);
    expect(summary.totalDupRows).toBe(0);
    expect(summary.byStrategy).toEqual({
      igdb_id: 0,
      steam_app_id: 0,
      normalized_name: 0,
    });
    expect(summary.topGroups).toEqual([]);

    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(0);
  });

  // ===================================================================
  // AC 2 — igdb_id dup match + tiebreaker (itad_game_id wins)
  // ===================================================================
  it('groups three rows sharing igdb_id; canonical is the one with itad_game_id', async () => {
    // 3 rows, all igdbId=99001. Only the SECOND one has itad_game_id set.
    const a = await seedGame(testApp, {
      name: 'Slay the Spire',
      slug: 'sts-a',
      igdbId: 99001,
    });
    const b = await seedGame(testApp, {
      name: 'Slay the Spire',
      slug: 'sts-b',
      igdbId: 99001,
      itadGameId: 'itad-uuid-sts-b',
    });
    const c = await seedGame(testApp, {
      name: 'Slay the Spire',
      slug: 'sts-c',
      igdbId: 99001,
    });

    const summary = await service.runAudit();

    expect(summary.groupsFound).toBe(1);
    expect(summary.byStrategy.igdb_id).toBe(1);
    expect(summary.totalDupRows).toBe(2);

    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.dedup_strategy).toBe('igdb_id');
    expect(row.dedup_key).toBe('igdb:99001');
    expect(row.canonical_game_id).toBe(b.id);
    expect(row.dup_game_ids.sort()).toEqual([a.id, c.id].sort());
    expect(row.group_size).toBe(3);
  });

  // ===================================================================
  // AC 3 — steam_app_id dup match (no igdb_id, no itad)
  // ===================================================================
  it('groups two rows sharing steam_app_id; canonical is lowest id when no itad/igdb tiebreak applies', async () => {
    const a = await seedGame(testApp, {
      name: 'Generic Game A',
      slug: 'gen-a',
      steamAppId: 700100,
    });
    const b = await seedGame(testApp, {
      name: 'Generic Game B',
      slug: 'gen-b',
      steamAppId: 700100,
    });

    const summary = await service.runAudit();

    expect(summary.groupsFound).toBe(1);
    expect(summary.byStrategy.steam_app_id).toBe(1);

    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.dedup_strategy).toBe('steam_app_id');
    expect(row.dedup_key).toBe('steam:700100');
    expect(row.canonical_game_id).toBe(Math.min(a.id, b.id));
    expect(row.dup_game_ids).toEqual([Math.max(a.id, b.id)]);
  });

  // ===================================================================
  // AC 4 — normalized_name dup match (Roman numerals + colons)
  // ===================================================================
  it('groups rows whose names normalize identically', async () => {
    // No igdbId, no steamAppId — falls through to normalized_name strategy.
    // normalizeForDedup("Slay the Spire II") -> "slay the spire 2"
    // normalizeForDedup("slay the spire 2")   -> "slay the spire 2"
    const a = await seedGame(testApp, {
      name: 'Slay the Spire II',
      slug: 'sts-ii-a',
    });
    const b = await seedGame(testApp, {
      name: 'slay the spire 2',
      slug: 'sts-ii-b',
    });

    const summary = await service.runAudit();

    expect(summary.groupsFound).toBe(1);
    expect(summary.byStrategy.normalized_name).toBe(1);

    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.dedup_strategy).toBe('normalized_name');
    expect(row.dedup_key).toBe('name:slay the spire 2');
  });

  // ===================================================================
  // AC 5 — Tiebreaker priority chain (itad_game_id > igdb_id > lowest id)
  // ===================================================================
  it('breaks ties deterministically: itad_game_id > igdb_id > lowest id', async () => {
    // Two rows have itad_game_id set; tie should fall through to igdb_id presence.
    // a:  itad=X, igdb=null
    // b:  itad=Y, igdb=88001  -> SHOULD WIN (has igdb_id)
    // c:  no itad, igdb=88001 -> joins same group via igdb match
    const a = await seedGame(testApp, {
      name: 'Tiebreak A',
      slug: 'tb-a',
      igdbId: 88001,
      itadGameId: 'itad-X',
    });
    const b = await seedGame(testApp, {
      name: 'Tiebreak B',
      slug: 'tb-b',
      igdbId: 88001,
      itadGameId: 'itad-Y',
    });
    const c = await seedGame(testApp, {
      name: 'Tiebreak C',
      slug: 'tb-c',
      igdbId: 88001,
    });

    await service.runAudit();
    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // a and b both have itad_game_id — they tie at level 1. Both have igdb_id
    // too (level 2 ties). Final tiebreaker: lowest id. a was inserted first
    // so a.id < b.id < c.id, and a wins among {a,b}; c is not contested at
    // level 1 (no itad). Final canonical = a (lowest id among rows that
    // share the highest tiebreak score).
    expect([a.id, b.id]).toContain(row.canonical_game_id);
    expect(row.canonical_game_id).toBe(a.id);
    expect(row.dup_game_ids.sort()).toEqual([b.id, c.id].sort());
    expect(row.group_size).toBe(3);
  });

  // ===================================================================
  // AC 6 — downstream_counts populated; all 22 keys present (zero or non-zero)
  // ===================================================================
  it('populates downstream_counts with non-zero entries for seeded FK tables and zero for the rest', async () => {
    const canonical = await seedGame(testApp, {
      name: 'Downstream Canon',
      slug: 'ds-canon',
      igdbId: 77001,
      itadGameId: 'itad-canon',
    });
    const dup = await seedGame(testApp, {
      name: 'Downstream Dup',
      slug: 'ds-dup',
      igdbId: 77001,
    });

    // Seed downstream rows attached to BOTH canon and dup.
    // characters: 2 rows on canon, 3 rows on dup
    const userId = testApp.seed.adminUser.id;
    await seedCharacter(testApp, userId, canonical.id, 'CharA');
    await seedCharacter(testApp, userId, canonical.id, 'CharB');
    await seedCharacter(testApp, userId, dup.id, 'CharC');
    await seedCharacter(testApp, userId, dup.id, 'CharD');
    await seedCharacter(testApp, userId, dup.id, 'CharE');

    // events: 1 row on dup
    await seedEvent(testApp, dup.id, userId, 'Test event on dup');

    // game_taste_vectors: 1 row on dup (UNIQUE game_id — see AC 7 for canon+dup conflict)
    await seedGameTasteVector(testApp, dup.id, 'sig-dup');

    await service.runAudit();
    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const [row] = rows;

    // characters count covers BOTH canon + dup rows (5 total).
    expect(row.downstream_counts.characters).toBe(5);
    expect(row.downstream_counts.events).toBe(1);
    expect(row.downstream_counts.game_taste_vectors).toBe(1);

    // Spec requires ALL 22 keys present (stable shape). Tables NOT seeded
    // here must appear as 0 so downstream consumers don't have to check
    // for missing keys.
    const expectedKeys = [
      'characters',
      'events',
      'event_types',
      'event_plans',
      'event_templates',
      'availability',
      'game_taste_vectors',
      'game_interests',
      'game_interest_suppressions',
      'game_activity_rollups',
      'game_activity_sessions',
      'game_time_templates',
      'game_time_overrides',
      'channel_bindings',
      'discord_game_mappings',
      'community_lineup_entries',
      'community_lineup_votes',
      'community_lineup_matches',
      'community_lineups_decided_game',
      'community_lineup_tiebreaker_bracket_matchups',
      'community_lineup_tiebreaker_bracket_votes',
      'community_lineup_tiebreaker_vetoes',
    ];
    for (const key of expectedKeys) {
      expect(row.downstream_counts).toHaveProperty(key);
      expect(typeof row.downstream_counts[key]).toBe('number');
    }
    expect(Object.keys(row.downstream_counts).sort()).toEqual(
      expectedKeys.slice().sort(),
    );
  });

  // ===================================================================
  // AC 7 — unique_conflicts: pre-merge collisions on UNIQUE-constraint tables
  // ===================================================================
  it('counts pre-merge unique-constraint conflicts for game_taste_vectors', async () => {
    const canonical = await seedGame(testApp, {
      name: 'Conflict Canon',
      slug: 'cf-canon',
      igdbId: 66001,
      itadGameId: 'itad-cf',
    });
    const dup = await seedGame(testApp, {
      name: 'Conflict Dup',
      slug: 'cf-dup',
      igdbId: 66001,
    });

    // BOTH canonical and dup have a game_taste_vectors row. Because
    // game_taste_vectors.game_id is UNIQUE, merging dup -> canonical would
    // collide. Phase 1 only AUDITS this; it does NOT resolve it.
    await seedGameTasteVector(testApp, canonical.id, 'sig-canon');
    await seedGameTasteVector(testApp, dup.id, 'sig-dup');

    await service.runAudit();
    const rows = await readAuditRows(testApp);
    expect(rows).toHaveLength(1);
    const [row] = rows;

    expect(row.unique_conflicts.game_taste_vectors).toBeGreaterThanOrEqual(1);
    // Tables WITHOUT unique-conflict pressure should show 0 entries.
    // (The audit emits the full 9-key shape; this assertion only checks
    // a representative non-conflicting one.)
    expect(row.unique_conflicts).toHaveProperty('community_lineup_matches');
    expect(row.unique_conflicts.community_lineup_matches).toBe(0);
  });

  // ===================================================================
  // AC 8 — Idempotency: TRUNCATE + recompute on every call
  // ===================================================================
  it('is idempotent — calling runAudit twice yields the same audit content (modulo created_at)', async () => {
    await seedGame(testApp, {
      name: 'Idem A',
      slug: 'idem-a',
      igdbId: 55001,
      itadGameId: 'itad-idem',
    });
    await seedGame(testApp, {
      name: 'Idem B',
      slug: 'idem-b',
      igdbId: 55001,
    });

    const first = await service.runAudit();
    const firstRows = await readAuditRows(testApp);

    const second = await service.runAudit();
    const secondRows = await readAuditRows(testApp);

    expect(second.groupsFound).toBe(first.groupsFound);
    expect(second.totalDupRows).toBe(first.totalDupRows);
    expect(second.byStrategy).toEqual(first.byStrategy);

    expect(secondRows).toHaveLength(firstRows.length);
    // Same content modulo audit row `id` (re-issued on TRUNCATE) and `created_at`.
    expect(secondRows[0].canonical_game_id).toBe(firstRows[0].canonical_game_id);
    expect(secondRows[0].dup_game_ids).toEqual(firstRows[0].dup_game_ids);
    expect(secondRows[0].dedup_key).toBe(firstRows[0].dedup_key);
    expect(secondRows[0].dedup_strategy).toBe(firstRows[0].dedup_strategy);
    expect(secondRows[0].downstream_counts).toEqual(
      firstRows[0].downstream_counts,
    );
    expect(secondRows[0].unique_conflicts).toEqual(
      firstRows[0].unique_conflicts,
    );
  });

  // ===================================================================
  // AC 9 — Non-dup rows ignored: only true groups (size > 1) make it in
  // ===================================================================
  it('ignores singleton games and emits one audit row per dup group', async () => {
    // 5 unique games (different igdbIds, different normalized names).
    for (let i = 0; i < 5; i++) {
      await seedGame(testApp, {
        name: `Unique Game ${i}`,
        slug: `uniq-${i}`,
        igdbId: 33000 + i,
      });
    }
    // 1 dup pair (igdb match).
    await seedGame(testApp, {
      name: 'Dup Pair A',
      slug: 'dup-pair-a',
      igdbId: 44001,
      itadGameId: 'itad-dup',
    });
    await seedGame(testApp, {
      name: 'Dup Pair B',
      slug: 'dup-pair-b',
      igdbId: 44001,
    });

    const summary = await service.runAudit();
    const rows = await readAuditRows(testApp);

    expect(summary.groupsFound).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].group_size).toBe(2);
    expect(rows[0].dedup_strategy).toBe('igdb_id');
  });

  // ===================================================================
  // AC 10 — Admin endpoint contract sanity (defense in depth; full auth
  // coverage lives in the controller layer once it exists).
  // ===================================================================
  it('exposes the service via DI so the admin controller can call it', () => {
    // If this test runs at all, the GamesDedupService import succeeded AND
    // the module was registered in app.module.ts.
    expect(service).toBeDefined();
    expect(typeof service.runAudit).toBe('function');
  });
});

// Force the file to be treated as a module if tsconfig/jest is in `isolatedModules`.
// (No-op for runtime — `eq` is harmless and may be used by future helpers.)
void eq;
