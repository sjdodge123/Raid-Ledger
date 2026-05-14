/**
 * ROK-1281: integration spec for `refreshDedupAudit` — the boot-time pre-step
 * that prevents migration 0140 from blowing up on a stale `games_dedup_audit`.
 *
 * Reproduces the prod incident:
 *   - games table has ≥1 dup group(s) NOT in the audit
 *   - games_dedup_audit has a stale or missing row
 *   - The migration's CREATE UNIQUE INDEX collides on the uncatalogued dup
 *
 * Verifies the runner repopulates the audit so the migration would succeed
 * on the next pass.
 */
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { refreshDedupAudit } from './run-migrations-with-sentry';

describe('ROK-1281 boot-time refreshDedupAudit', () => {
  let testApp: TestApp;
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    testApp = await getTestApp();
    client = postgres(process.env.DATABASE_URL!, { max: 1 });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('repopulates audit when uncatalogued dups exist (prod incident replay)', async () => {
    // Two name-only dup groups, neither in the audit table.
    // (steam_app_id UNIQUE prevents seeding the literal Slay 2/II case here,
    // but the union-find logic is identical — name-key shows the same gap.)
    const games = await testApp.db
      .insert(schema.games)
      .values([
        { name: 'Test Stale-Dup A', slug: 'test-stale-a-canon' },
        { name: 'Test Stale-Dup A', slug: 'test-stale-a-dup' },
        { name: 'Test Stale-Dup B', slug: 'test-stale-b-canon' },
        { name: 'Test Stale-Dup B', slug: 'test-stale-b-dup' },
      ])
      .returning({ id: schema.games.id });

    // Seed a stale audit row that references a now-irrelevant pair — exactly
    // the ROK-1278 prod state where 1 stale row existed but the real
    // duplicates were uncatalogued.
    await testApp.db.execute(sql`
      INSERT INTO games_dedup_audit (
        match_type, match_key, canonical_game_id, dup_game_ids,
        group_size, downstream_counts, unique_conflicts, snapshot_at
      ) VALUES (
        'name', 'stale', ${games[0].id}, ARRAY[${games[1].id}]::int[],
        2, '{}'::jsonb, '{}'::jsonb, NOW()
      )
    `);

    // Sanity: audit has the stale row.
    const before = (await testApp.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM games_dedup_audit`,
    )) as unknown as Array<{ c: number }>;
    expect(before[0].c).toBe(1);

    const inserted = await refreshDedupAudit(client);

    // Both dup groups should now be in the audit.
    expect(inserted).toBe(2);

    const after = (await testApp.db.execute(sql`
      SELECT match_type, canonical_game_id, dup_game_ids
      FROM games_dedup_audit
      ORDER BY canonical_game_id
    `)) as unknown as Array<{
      match_type: string;
      canonical_game_id: number;
      dup_game_ids: number[];
    }>;
    expect(after).toHaveLength(2);
    for (const row of after) {
      expect(row.match_type).toBe('name');
      expect(row.dup_game_ids).toHaveLength(1);
    }
  });

  it('truncates the audit when no dups exist', async () => {
    // Seed a stale audit row pointing at non-existent games (ON DELETE
    // shouldn't fire here — we just want a row to verify TRUNCATE).
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name: 'Test Solo', slug: 'test-solo' })
      .returning({ id: schema.games.id });
    await testApp.db.execute(sql`
      INSERT INTO games_dedup_audit (
        match_type, match_key, canonical_game_id, dup_game_ids,
        group_size, downstream_counts, unique_conflicts, snapshot_at
      ) VALUES (
        'name', 'stale', ${game.id}, ARRAY[]::int[],
        1, '{}'::jsonb, '{}'::jsonb, NOW()
      )
    `);

    const inserted = await refreshDedupAudit(client);
    expect(inserted).toBe(0);

    const after = (await testApp.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM games_dedup_audit`,
    )) as unknown as Array<{ c: number }>;
    expect(after[0].c).toBe(0);
  });

  it('is idempotent across repeated calls', async () => {
    await testApp.db.insert(schema.games).values([
      { name: 'Test Idem A', slug: 'test-idem-a-1' },
      { name: 'Test Idem A', slug: 'test-idem-a-2' },
    ]);

    const first = await refreshDedupAudit(client);
    const second = await refreshDedupAudit(client);
    expect(first).toBe(1);
    expect(second).toBe(1);

    const rows = (await testApp.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM games_dedup_audit`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0].c).toBe(1);
  });
});
