/**
 * ROK-1464 — integration coverage for `GET /games/slug/:slug`.
 *
 * The LFG group page is addressed by slug (`/lfg/:gameSlug`) while every other
 * games/LFG route is `ParseIntPipe`-keyed, so this one lookup is what stands
 * between a deep link and a 400 on the first read the page issues.
 *
 * Covers the three behaviours the page depends on:
 *   200 — the id/slug/name triple for a seeded game.
 *   404 — an unknown slug (NOT a 200 with an empty body, and NOT an import).
 *   401 — anonymous callers, matching every other authenticated games route.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';

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

describe('GET /games/slug/:slug (integration)', () => {
  it('resolves a seeded slug to its id, slug and name', async () => {
    const seeded = testApp.seed.game;

    const res = await testApp.request
      .get(`/games/slug/${seeded.slug}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: seeded.id,
      slug: seeded.slug,
      name: seeded.name,
    });
  });

  it('404s an unknown slug rather than importing it', async () => {
    const res = await testApp.request
      .get('/games/slug/no-such-game-anywhere')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('does not collide with the id-keyed detail route', async () => {
    const seeded = testApp.seed.game;

    const bySlug = await testApp.request
      .get(`/games/slug/${seeded.slug}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const byId = await testApp.request
      .get(`/games/${bySlug.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(byId.status).toBe(200);
    expect(byId.body.slug).toBe(seeded.slug);
  });

  it('401s anonymous callers', async () => {
    const res = await testApp.request.get(
      `/games/slug/${testApp.seed.game.slug}`,
    );

    expect(res.status).toBe(401);
  });
});
