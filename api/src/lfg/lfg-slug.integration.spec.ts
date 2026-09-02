/**
 * ROK-1453 AC8 — `gameSlug` on the two LFG read DTOs.
 *
 * Both the tile chip and the cold-start prompt link to `/lfg/:gameSlug`, so
 * every row `GET /lfg` and `GET /lfg/hearted` return has to carry the slug the
 * router will resolve. `games.slug` is NOT NULL UNIQUE
 * (`api/src/drizzle/schema/games.ts:27`), so this is a join column, not a
 * migration (spec decision D2).
 *
 * TDD — written before the implementation. Two failure classes are asserted
 * separately on purpose:
 *
 *   1. the ENDPOINT half — `lfg-query.helpers.ts::listActiveGroups` /
 *      `::listHeartedWithoutIntent` do not select `games.slug` yet, so the raw
 *      response body has no `gameSlug` at all;
 *   2. the CONTRACT half — `LfgGroupSummarySchema` / `LfgHeartedGameSchema` do
 *      not declare `gameSlug`, so zod STRIPS it. A response that ships the
 *      column while the schema stays silent still fails here, which is the
 *      whole point of parsing the live body rather than asserting on it twice.
 *
 * The contract half lives in this file rather than in
 * `packages/contract/src/__tests__/` because nothing runs that directory —
 * neither vitest config's `include` covers it (see the TDD report / tech-debt
 * entry). A parse test placed there would never execute.
 *
 * Local response types are declared inline (same convention as
 * `lfg.integration.spec-helpers.ts`) so this file compiles against the
 * PRE-implementation contract and every test fails on its own runtime
 * assertion instead of the whole suite dying on a type error.
 */
import {
  LfgGroupSummarySchema,
  LfgHeartedGameSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createGame, heartGame } from './lfg.integration.spec-helpers';

/** The row shape this story adds `gameSlug` to. */
interface SlugBearingRow {
  gameId: number;
  gameName: string;
  gameSlug: string;
}

let testApp: TestApp;
let adminToken: string;
let adminUserId: number;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

/** Resolve the logged-in admin's user id (hearts are seeded by id). */
async function whoAmI(): Promise<number> {
  const res = await testApp.request
    .get('/auth/me')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return (res.body as { id: number }).id;
}

describe('GET /lfg — gameSlug (AC8)', () => {
  it('returns the games.slug of every grouped game', async () => {
    const game = await createGame(testApp, 'Slug Bearing Game');

    const posted = await testApp.request
      .post('/lfg')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: game.id });
    expect(posted.status).toBe(201);

    const res = await testApp.request
      .get('/lfg')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = res.body as SlugBearingRow[];
    const row = rows.find((r) => r.gameId === game.id);
    expect(row).toBeDefined();
    expect(row!.gameSlug).toBe(game.slug);
    // The chip links to `/lfg/${gameSlug}`; the smoke spec asserts that URL
    // against /\/lfg\/[a-z0-9-]+$/, so the value has to be URL-safe.
    expect(row!.gameSlug).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps gameSlug through LfgGroupSummarySchema (contract half)', async () => {
    const game = await createGame(testApp, 'Contract Parsed Game');
    await testApp.request
      .post('/lfg')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: game.id });

    const res = await testApp.request
      .get('/lfg')
      .set('Authorization', `Bearer ${adminToken}`);
    const raw = (res.body as SlugBearingRow[]).find(
      (r) => r.gameId === game.id,
    );

    // zod strips unknown keys: this passes ONLY when the schema declares the
    // field, so it fails on a response-only implementation too.
    const parsed = LfgGroupSummarySchema.parse(raw) as Record<string, unknown>;
    expect(parsed.gameSlug).toBe(game.slug);
  });
});

describe('GET /lfg/hearted — gameSlug (AC8)', () => {
  it('returns the games.slug of every hearted game', async () => {
    adminUserId = await whoAmI();
    const game = await createGame(testApp, 'Hearted Slug Game');
    await heartGame(testApp, adminUserId, game.id);

    const res = await testApp.request
      .get('/lfg/hearted')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows = res.body as SlugBearingRow[];
    const row = rows.find((r) => r.gameId === game.id);
    expect(row).toBeDefined();
    expect(row!.gameSlug).toBe(game.slug);
  });

  it('keeps gameSlug through LfgHeartedGameSchema (contract half)', async () => {
    adminUserId = await whoAmI();
    const game = await createGame(testApp, 'Hearted Contract Game');
    await heartGame(testApp, adminUserId, game.id);

    const res = await testApp.request
      .get('/lfg/hearted')
      .set('Authorization', `Bearer ${adminToken}`);
    const raw = (res.body as SlugBearingRow[]).find(
      (r) => r.gameId === game.id,
    );

    const parsed = LfgHeartedGameSchema.parse(raw) as Record<string, unknown>;
    expect(parsed.gameSlug).toBe(game.slug);
  });
});

describe('LFG reads honour the shared visibility filter (Codex P1)', () => {
  it('omits a hidden game from GET /lfg even with a live intent', async () => {
    // The `?lfg=1` grid renders whatever GET /lfg returns, so an admin-hidden
    // or banned game reaching this list puts it straight back on the Library —
    // the exact leak `VISIBILITY_FILTER` exists to prevent everywhere else
    // (`igdb-discover-deals.helpers.ts:133`, and siblings).
    const visible = await createGame(testApp, 'Visible LFG Game');
    const hidden = await createGame(testApp, 'Hidden LFG Game', {
      hidden: true,
    });
    const banned = await createGame(testApp, 'Banned LFG Game', {
      banned: true,
    });
    for (const game of [visible, hidden, banned]) {
      const posted = await testApp.request
        .post('/lfg')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: game.id });
      expect(posted.status).toBe(201);
    }

    const res = await testApp.request
      .get('/lfg')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const ids = (res.body as SlugBearingRow[]).map((r) => r.gameId);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(banned.id);
  });

  it('omits a hidden game from GET /lfg/hearted', async () => {
    adminUserId = await whoAmI();
    const visible = await createGame(testApp, 'Visible Hearted Game');
    const hidden = await createGame(testApp, 'Hidden Hearted Game', {
      hidden: true,
    });
    await heartGame(testApp, adminUserId, visible.id);
    await heartGame(testApp, adminUserId, hidden.id);

    const res = await testApp.request
      .get('/lfg/hearted')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const ids = (res.body as SlugBearingRow[]).map((r) => r.gameId);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
  });
});
