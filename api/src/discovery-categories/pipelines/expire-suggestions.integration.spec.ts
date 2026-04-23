/**
 * Integration tests for `runExpireSuggestions` (ROK-567). Asserts that the
 * reaper flips stale approved rows to 'expired' without touching pending or
 * unexpired rows.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { runExpireSuggestions } from './expire-suggestions';

describe('runExpireSuggestions (ROK-567)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seed(
    name: string,
    status: 'pending' | 'approved' | 'rejected' | 'expired',
    expiresAt: Date | null,
  ): Promise<string> {
    const [row] = await testApp.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name,
        description: 'd',
        categoryType: 'trend',
        themeVector: [0, 0, 0, 0, 0, 0, 0],
        status,
        populationStrategy: 'vector',
        expiresAt,
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });
    return row.id;
  }

  async function statusOf(id: string): Promise<string | null> {
    const [row] = await testApp.db
      .select({ status: schema.discoveryCategorySuggestions.status })
      .from(schema.discoveryCategorySuggestions)
      .where(eq(schema.discoveryCategorySuggestions.id, id))
      .limit(1);
    return row?.status ?? null;
  }

  it('expires stale approved rows and leaves others alone', async () => {
    const pastApproved = await seed(
      'Past Approved',
      'approved',
      new Date(Date.now() - 60_000),
    );
    const futureApproved = await seed(
      'Future Approved',
      'approved',
      new Date(Date.now() + 60_000),
    );
    const nullExpiry = await seed('Never Expires', 'approved', null);
    const pending = await seed(
      'Stale Pending',
      'pending',
      new Date(Date.now() - 60_000),
    );

    const expired = await runExpireSuggestions(testApp.db);
    expect(expired).toBe(1);
    expect(await statusOf(pastApproved)).toBe('expired');
    expect(await statusOf(futureApproved)).toBe('approved');
    expect(await statusOf(nullExpiry)).toBe('approved');
    expect(await statusOf(pending)).toBe('pending');
  });

  it('returns 0 when no rows are eligible', async () => {
    await seed('Pending Only', 'pending', new Date(Date.now() - 60_000));
    const expired = await runExpireSuggestions(testApp.db);
    expect(expired).toBe(0);
  });
});
