/**
 * GET /lineups/banner?lineupId= scope integration tests.
 *
 * The `lineupId` query param is a demo-only test seam that pins the banner to
 * one lineup so parallel smoke specs stop fighting over the global "newest
 * lineup" banner. It needs BOTH demo keys (env DEMO_MODE and the demo_mode
 * app setting); with either off it must be inert, and a scoped lineup that is
 * not banner-eligible must yield no banner — never the global one.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

/** Shared app + admin token (refreshed after every truncate) + setting to restore. */
const ctx = {} as { app: TestApp; token: string; originalSetting: boolean };

function restoreDemoMode(): void {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
}

/** Set both demo keys: env DEMO_MODE and the demo_mode app setting. */
async function setDemoKeys(env: boolean, setting: boolean): Promise<void> {
  if (env) process.env.DEMO_MODE = 'true';
  else delete process.env.DEMO_MODE;
  await ctx.app.app.get(SettingsService).setDemoMode(setting);
}

async function createLineup(title: string): Promise<number> {
  const res = await ctx.app.request
    .post('/lineups')
    .set('Authorization', `Bearer ${ctx.token}`)
    .send({ title });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** Lineup A first, then B — B is the newest, so the global banner. */
async function createTwoLineups(): Promise<{ a: number; b: number }> {
  const a = await createLineup('Scope Lineup A');
  const b = await createLineup('Scope Lineup B');
  return { a, b };
}

const getBanner = (query: string) =>
  ctx.app.request
    .get(`/lineups/banner${query}`)
    .set('Authorization', `Bearer ${ctx.token}`);

function scopedCases() {
  it('returns the scoped lineup when both demo keys are on', async () => {
    const { a } = await createTwoLineups();
    await setDemoKeys(true, true);

    const res = await getBanner(`?lineupId=${a}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a);
  });

  it('returns no banner for an archived scoped lineup, never the global one', async () => {
    const { a, b } = await createTwoLineups();
    await ctx.app.db
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, a));
    await setDemoKeys(true, true);

    const res = await getBanner(`?lineupId=${a}`);

    expect(res.status).toBe(200);
    expect(res.body?.id).not.toBe(b);
    expect(res.body?.id).toBeUndefined();
  });
}

function inertCases() {
  it('ignores the scope when env DEMO_MODE is unset', async () => {
    const { a, b } = await createTwoLineups();
    await setDemoKeys(false, true);

    const res = await getBanner(`?lineupId=${a}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(b);
  });

  it('ignores the scope when the demo_mode setting is off', async () => {
    const { a, b } = await createTwoLineups();
    await setDemoKeys(true, false);

    const res = await getBanner(`?lineupId=${a}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(b);
  });

  it('ignores a non-numeric scope even when both demo keys are on', async () => {
    const { b } = await createTwoLineups();
    await setDemoKeys(true, true);

    const res = await getBanner('?lineupId=abc');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(b);
  });
}

function describeBannerScope() {
  beforeAll(async () => {
    ctx.app = await getTestApp();
    ctx.token = await loginAsAdmin(ctx.app.request, ctx.app.seed);
    ctx.originalSetting = await ctx.app.app.get(SettingsService).getDemoMode();
  });

  afterEach(async () => {
    restoreDemoMode();
    ctx.app.seed = await truncateAllTables(ctx.app.db);
    ctx.token = await loginAsAdmin(ctx.app.request, ctx.app.seed);
  });

  afterAll(async () => {
    restoreDemoMode();
    await ctx.app.app.get(SettingsService).setDemoMode(ctx.originalSetting);
  });

  describe('scope honoured', scopedCases);
  describe('scope inert', inertCases);
}

describe('Lineups — banner lineupId scope (integration)', describeBannerScope);
