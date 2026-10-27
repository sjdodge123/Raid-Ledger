/**
 * ROK-2015 I5 — the 0261 data backfill against a real database. The test DB
 * is already migrated, so the spec seeds rows that look pre-0261 (WoW with
 * `source_name` NULL) and re-runs the migration's own SQL text, split on
 * drizzle's statement breakpoint. Fleet-only.
 *
 * Mutation (for the Lead): drop `AND "kind" = 'wow_guild'` from the 0261
 * UPDATE → the community row reads 'Community Hub' instead of null.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { insertCommunityHub } from './community/community-proposals.queries';

const MIGRATIONS = join(__dirname, '../drizzle/migrations');
const g = schema.guilds;
let testApp: TestApp;

/** The statements of the single `0261_*.sql` migration file. */
function backfillStatements(): string[] {
  const files = readdirSync(MIGRATIONS).filter(
    (f) => f.startsWith('0261_') && f.endsWith('.sql'),
  );
  expect(files).toHaveLength(1);
  const [file] = nonEmpty(files, '0261 migration');
  return readFileSync(join(MIGRATIONS, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function runBackfill(): Promise<void> {
  for (const stmt of backfillStatements()) {
    await testApp.db.execute(sql.raw(stmt));
  }
}

async function mkWow(name: string, sourceName: string | null): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(g)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        sourceName,
        source: 'addon_import',
      })
      .returning({ id: g.id }),
    `wow ${name}`,
  );
  return row.id;
}

async function sourceOf(id: number): Promise<string | null> {
  const rows = await testApp.db
    .select({ s: g.sourceName })
    .from(g)
    .where(eq(g.id, id));
  return nonEmpty(rows, `guild ${id}`)[0].s;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2015 I5 — 0261 backfills source_name for WoW guilds only', () => {
  it('sets source_name = name on WoW rows without one; idempotent', async () => {
    const legacy = await mkWow('Night Shift', null);
    const kept = await mkWow('Iron Vanguard', 'Iron Vanguard Old');
    const hub = await insertCommunityHub(testApp.db, {
      gameId: testApp.seed.game.id,
      name: 'Community Hub',
      blurb: 'Backfill',
      status: 'active',
      proposedBy: testApp.seed.adminUser.id,
      reviewedBy: testApp.seed.adminUser.id,
    });
    const expected = ['Night Shift', 'Iron Vanguard Old', null];
    for (let run = 1; run <= 2; run += 1) {
      await runBackfill();
      const got = [
        await sourceOf(legacy),
        await sourceOf(kept),
        await sourceOf(hub.id),
      ];
      expect([run, ...got]).toEqual([run, ...expected]);
    }
  });
});
