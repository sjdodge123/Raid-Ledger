/**
 * ROK-1278: integration spec for the games-dedup merge migration (0140).
 *
 * The migration itself is one-shot SQL that runs during deploy. This spec
 * exercises the merge LOGIC by:
 *   1. Seeding a dup pattern (one steam-key dup + one name-key dup) with
 *      downstream rows (rollups, characters, interests).
 *   2. POSTing /admin/games/dedup-audit/run to populate games_dedup_audit.
 *   3. Re-executing the same multi-statement SQL the migration would, against
 *      the test DB.
 *   4. Asserting: dup games gone, FKs repointed, additive rollup merge worked,
 *      audit re-run returns zero groups.
 *
 * The steam_app_id UNIQUE index is already installed by the migration during
 * the test DB's initial migration run — verifying it exists at the end is
 * a separate quick check.
 */
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import path from 'path';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

const MIGRATION_SQL_PATH = path.join(
  __dirname,
  '../drizzle/migrations/0140_games_dedup_merge.sql',
);

async function executeMigrationSql(testApp: TestApp): Promise<void> {
  const raw = readFileSync(MIGRATION_SQL_PATH, 'utf8');
  // Strip line-comments + blank lines, then split on `;` at end-of-statement.
  // Migration uses no `;` inside string literals or DO blocks, so simple split
  // is safe here.
  const stripped = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = stripped
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await testApp.db.execute(sql.raw(stmt));
  }
}

describe('ROK-1278 games-dedup merge migration', () => {
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

  it('merges dup groups: deletes dup games, repoints FKs, additively sums rollups', async () => {
    // ── Seed: 2 name-only dup pairs (steam_app_id UNIQUE prevents steam dups) ─
    // The first pair exercises Roman-numeral normalization (2 ↔ II).
    const games = await testApp.db
      .insert(schema.games)
      .values([
        { name: 'Test Slay 2', slug: 'test-slay-2' }, // canonical (no shared id)
        { name: 'Test Slay II', slug: 'test-slay-ii' }, // dup (name-key via roman)
        { name: 'Test BG 3', slug: 'test-bg-3' }, // canonical
        { name: 'Test BG 3', slug: 'test-bg-3-alt' }, // dup (exact-name)
      ])
      .returning({ id: schema.games.id });
    const [slayCanonId, slayDupId, bgCanonId, bgDupId] = games.map((g) => g.id);

    const userId = testApp.seed.adminUser.id;

    // ── Seed: rollups on canonical AND dup (so additive merge applies) ────
    await testApp.db.insert(schema.gameActivityRollups).values([
      // Slay canonical: u1 = 10h
      {
        userId,
        gameId: slayCanonId,
        period: 'week',
        periodStart: '2026-05-01',
        totalSeconds: 36000,
      },
      // Slay dup: u1 = 5h on SAME (user, period, period_start) → additive
      {
        userId,
        gameId: slayDupId,
        period: 'week',
        periodStart: '2026-05-01',
        totalSeconds: 18000,
      },
      // Slay dup: u1 = 3h on DIFFERENT period → repoint, no merge
      {
        userId,
        gameId: slayDupId,
        period: 'week',
        periodStart: '2026-05-08',
        totalSeconds: 10800,
      },
    ]);

    // ── Seed: characters + interests on dup side (canonical-wins delete) ──
    await testApp.db.insert(schema.characters).values([
      { userId, gameId: bgCanonId, name: 'Dupe-Conflict', realm: 'R1' },
      { userId, gameId: bgDupId, name: 'Dupe-Conflict', realm: 'R1' }, // collision
      { userId, gameId: bgDupId, name: 'Survivor', realm: 'R1' }, // repoint
    ]);

    // ── Populate games_dedup_audit ────────────────────────────────────────
    const auditRes = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.totalGroups).toBeGreaterThanOrEqual(2);

    // ── Run the migration SQL ─────────────────────────────────────────────
    await executeMigrationSql(testApp);

    // ── Assert: dup game rows are gone ────────────────────────────────────
    const remaining = await testApp.db.execute(sql<{ id: number }>`
      SELECT id FROM games WHERE id IN (${slayDupId}, ${bgDupId})
    `);
    expect(remaining).toEqual([]);

    // ── Assert: rollups additively merged ─────────────────────────────────
    const merged = await testApp.db.execute<{ totalSeconds: number }>(sql`
      SELECT total_seconds FROM game_activity_rollups
      WHERE game_id = ${slayCanonId} AND user_id = ${userId}
        AND period = 'week' AND period_start = '2026-05-01'
    `);
    expect((merged as { total_seconds: number }[])[0].total_seconds).toBe(
      36000 + 18000,
    );

    // ── Assert: non-colliding dup rollup got repointed (not duplicated) ───
    const repointed = await testApp.db.execute(sql`
      SELECT period_start, total_seconds FROM game_activity_rollups
      WHERE game_id = ${slayCanonId} AND period = 'week'
      ORDER BY period_start
    `);
    expect((repointed as { total_seconds: number }[]).length).toBe(2);

    // ── Assert: characters — canonical wins on collision, survivor repointed
    const charRows = await testApp.db.execute<{
      gameId: number;
      name: string;
    }>(sql`
      SELECT game_id, name FROM characters
      WHERE user_id = ${userId} AND game_id IN (${bgCanonId}, ${bgDupId})
      ORDER BY name
    `);
    const charArr = charRows as { game_id: number; name: string }[];
    expect(charArr).toHaveLength(2); // Dupe-Conflict (canonical) + Survivor (repointed)
    expect(charArr.every((c) => c.game_id === bgCanonId)).toBe(true);

    // ── Assert: audit is empty after merge ────────────────────────────────
    const post = await testApp.request
      .post('/admin/games/dedup-audit/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(post.status).toBe(200);
    expect(post.body.totalGroups).toBe(0);

    // ── Assert: steam_app_id UNIQUE index exists ──────────────────────────
    const idx = await testApp.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM pg_indexes
      WHERE tablename = 'games' AND indexname = 'games_steam_app_id_unique'
    `);
    expect((idx as { count: number }[])[0].count).toBe(1);
  }, 60_000);

  it('rejects an INSERT into games that would duplicate steam_app_id (UNIQUE index works)', async () => {
    await testApp.db.insert(schema.games).values({
      name: 'Steam-Unique-Test A',
      slug: 'steam-unique-a',
      steamAppId: 88880001,
    });

    await expect(
      testApp.db.insert(schema.games).values({
        name: 'Steam-Unique-Test B',
        slug: 'steam-unique-b',
        steamAppId: 88880001,
      }),
    ).rejects.toThrow();
  }, 30_000);
});
