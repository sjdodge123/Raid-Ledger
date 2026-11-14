/**
 * Integration contract for the single-statement reset (ROK-2196).
 *
 * `truncateAllTables` runs one DO block that DELETEs every public table with
 * FK triggers off (`session_replication_role = replica`, transaction-local).
 * This pins what that must leave behind: every pooled connection back in
 * `origin` mode, `cron_jobs` untouched (seeded at boot, read by live cron
 * handlers), and every other table empty apart from the re-seeded baseline.
 */
import { count, eq, sql } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from './test-app';
import { truncateAllTables } from './integration-helpers';
import { nonEmpty } from './narrow';

const SENTINEL_CRON = 'rok-2196:truncate-sentinel';

async function rowCount(
  testApp: TestApp,
  table: typeof schema.users | typeof schema.games | typeof schema.events,
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db.select({ n: count() }).from(table),
    'count row',
  );
  return row.n;
}

describe('truncateAllTables single-statement reset (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    await testApp.db
      .delete(schema.cronJobs)
      .where(eq(schema.cronJobs.name, SENTINEL_CRON));
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('leaves every pooled connection with session_replication_role = origin', async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    // Ten parallel reads fan out over the pool (max 10), so the connection
    // that ran the DO block is among them.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        testApp.db.execute<{ role: string }>(
          sql`SELECT current_setting('session_replication_role') AS role`,
        ),
      ),
    );
    const roles = results.flatMap((rows) => Array.from(rows, (r) => r.role));
    expect(roles).toHaveLength(10);
    expect(new Set(roles)).toEqual(new Set(['origin']));
  });

  it('keeps cron_jobs rows and resets other tables to the seeded baseline', async () => {
    await testApp.db.insert(schema.cronJobs).values({
      name: SENTINEL_CRON,
      source: 'core',
      cronExpression: '0 0 * * *',
    });
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'rok-2196:extra', username: 'rok2196extra' });
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Extra Game', slug: 'rok-2196-extra-game' });
    expect(await rowCount(testApp, schema.users)).toBeGreaterThanOrEqual(2);

    testApp.seed = await truncateAllTables(testApp.db);

    const sentinel = await testApp.db
      .select({ name: schema.cronJobs.name })
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.name, SENTINEL_CRON));
    expect(sentinel).toEqual([{ name: SENTINEL_CRON }]);
    const users = await testApp.db
      .select({ username: schema.users.username })
      .from(schema.users);
    expect(users).toEqual([{ username: 'admin' }]);
    const games = await testApp.db
      .select({ slug: schema.games.slug })
      .from(schema.games);
    expect(games).toEqual([{ slug: 'test-game' }]);
    expect(await rowCount(testApp, schema.events)).toBe(0);
  });
});
