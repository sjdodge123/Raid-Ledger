/**
 * GET /lineups/banner?lineupId= scope integration tests.
 *
 * The `lineupId` query param is a DEMO_MODE-only test seam that pins the
 * banner to one lineup so parallel smoke specs stop fighting over the global
 * "newest lineup" banner. Outside DEMO_MODE it must be inert, and a scoped
 * lineup that is not banner-eligible must yield no banner — never the global
 * one.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

function restoreDemoMode(): void {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
}

async function createLineup(
  app: TestApp,
  token: string,
  title: string,
): Promise<number> {
  const res = await app.request
    .post('/lineups')
    .set('Authorization', `Bearer ${token}`)
    .send({ title });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

function describeBannerScope() {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    restoreDemoMode();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterAll(restoreDemoMode);

  /** Lineup A first, then B — B is the newest, so the global banner. */
  async function createTwoLineups(): Promise<{ a: number; b: number }> {
    const a = await createLineup(testApp, adminToken, 'Scope Lineup A');
    const b = await createLineup(testApp, adminToken, 'Scope Lineup B');
    return { a, b };
  }

  const getBanner = (query: string) =>
    testApp.request
      .get(`/lineups/banner${query}`)
      .set('Authorization', `Bearer ${adminToken}`);

  it('returns the scoped lineup when DEMO_MODE is true', async () => {
    const { a } = await createTwoLineups();
    process.env.DEMO_MODE = 'true';

    const res = await getBanner(`?lineupId=${a}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a);
  });

  it('ignores the scope when DEMO_MODE is unset', async () => {
    const { a, b } = await createTwoLineups();
    delete process.env.DEMO_MODE;

    const res = await getBanner(`?lineupId=${a}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(b);
  });

  it('returns no banner for an archived scoped lineup, never the global one', async () => {
    const { a, b } = await createTwoLineups();
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, a));
    process.env.DEMO_MODE = 'true';

    const res = await getBanner(`?lineupId=${a}`);

    expect(res.status).toBe(200);
    expect(res.body?.id).not.toBe(b);
    expect(res.body?.id).toBeUndefined();
  });

  it('ignores a non-numeric scope even when DEMO_MODE is true', async () => {
    const { b } = await createTwoLineups();
    process.env.DEMO_MODE = 'true';

    const res = await getBanner('?lineupId=abc');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(b);
  });
}

describe('Lineups — banner lineupId scope (integration)', describeBannerScope);
