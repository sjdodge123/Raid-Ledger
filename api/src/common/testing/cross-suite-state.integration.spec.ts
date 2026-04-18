/**
 * Regression: cross-suite in-memory state is cleared by truncateAllTables.
 *
 * ROK-1059 — full-suite local runs were flaking with 401 on authenticated
 * POSTs issued right after `loginAsAdmin`. Root cause: `jwt_block:<userId>`
 * entries written by earlier files (via `TokenBlocklistService.blockUser`
 * during role changes / deletes) stayed in the module-level mock Redis
 * store. When the fresh admin's id collided with one of those stale keys,
 * `JwtStrategy.validate` rejected the just-issued token.
 *
 * `truncateAllTables` must now clear both the auth-user cache and the
 * `jwt_block:*` keys from the mock Redis store — the one authoritative
 * "reset module state" entry point between suites.
 */
import { getTestApp, type TestApp } from './test-app';
import { truncateAllTables, loginAsAdmin } from './integration-helpers';
import {
  getCachedAuthUser,
  setCachedAuthUser,
} from '../../auth/auth-user-cache';
import { TokenBlocklistService } from '../../auth/token-blocklist.service';

function describeCrossSuiteState() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('clears jwt_block:* keys so a fresh admin token is accepted after truncate', async () => {
    const blocklist = testApp.app.get(TokenBlocklistService);
    // Simulate an earlier suite blocking the currently-seeded admin.
    await blocklist.blockUser(testApp.seed.adminUser.id);
    const storeBefore = testApp.redisMock.store;
    expect(
      [...storeBefore.keys()].some((k) => k.startsWith('jwt_block:')),
    ).toBe(true);

    // Truncate + re-seed — this is what every suite's afterEach does.
    testApp.seed = await truncateAllTables(testApp.db);

    const storeAfter = testApp.redisMock.store;
    expect(
      [...storeAfter.keys()].filter((k) => k.startsWith('jwt_block:')),
    ).toEqual([]);

    // The canonical failure mode: login + authenticated request must 200,
    // not 401, right after truncate.
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const res = await testApp.request
      .get('/events/my-dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('clears the auth-user cache so stale role/discordId data does not leak', async () => {
    const staleId = 999_999;
    setCachedAuthUser(staleId, { role: 'member', discordId: 'stale' });
    expect(getCachedAuthUser(staleId)).not.toBeNull();

    testApp.seed = await truncateAllTables(testApp.db);

    expect(getCachedAuthUser(staleId)).toBeNull();
  });
}

describe('Cross-suite state reset (integration)', () =>
  describeCrossSuiteState());
