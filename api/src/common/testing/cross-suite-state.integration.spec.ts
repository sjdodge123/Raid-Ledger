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
import { _isKeyCached, getEncryptionKey } from '../../settings/encryption.util';
import {
  _cooldownsSize,
  setCooldown,
} from '../../discord-bot/listeners/signup-interaction.helpers';
import {
  _recentlyProcessedSize,
  _setRecentlyProcessed,
} from '../../discord-bot/listeners/event-link.dedup';
import { _inFlightRefreshesSize, _setInFlightRefresh } from '../swr-cache';

function describeOriginalResets(testAppRef: { current: TestApp }) {
  it('clears jwt_block:* keys so a fresh admin token is accepted after truncate', async () => {
    const testApp = testAppRef.current;
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
    const testApp = testAppRef.current;
    const staleId = 999_999;
    setCachedAuthUser(staleId, {
      role: 'member',
      discordId: 'stale',
      deactivatedAt: null,
      kickedAt: null,
      bannedAt: null,
      banReason: null,
    });
    expect(getCachedAuthUser(staleId)).not.toBeNull();

    testApp.seed = await truncateAllTables(testApp.db);

    expect(getCachedAuthUser(staleId)).toBeNull();
  });
}

// ROK-1245: 4 module-scoped singletons that survive `app.close()` and
// retained references to prior apps' DI containers across spec files.
// The SWR `inFlightRefreshes` map was the dominant carrier — promises
// closed over the previous file's NestJS service instances.
function describeModuleSingletonResets(testAppRef: { current: TestApp }) {
  it('clears the encryption key cache so a JWT_SECRET rotation between suites is honored', async () => {
    const testApp = testAppRef.current;
    getEncryptionKey();
    expect(_isKeyCached()).toBe(true);

    testApp.seed = await truncateAllTables(testApp.db);

    expect(_isKeyCached()).toBe(false);
  });

  it('clears Discord signup-interaction cooldowns so a cooldown from one suite does not suppress the next', async () => {
    const testApp = testAppRef.current;
    setCooldown('event:1:user:42', Date.now());
    expect(_cooldownsSize()).toBeGreaterThan(0);

    testApp.seed = await truncateAllTables(testApp.db);

    expect(_cooldownsSize()).toBe(0);
  });

  it("clears event-link unfurl dedup map so a prior suite's unfurl does not block the next", async () => {
    const testApp = testAppRef.current;
    _setRecentlyProcessed('msg:42:event:1', Date.now());
    expect(_recentlyProcessedSize()).toBeGreaterThan(0);

    testApp.seed = await truncateAllTables(testApp.db);

    expect(_recentlyProcessedSize()).toBe(0);
  });

  it("clears SWR in-flight refresh tracker so a prior suite's pending promise cannot deliver to the next", async () => {
    const testApp = testAppRef.current;
    _setInFlightRefresh(
      'blizzard:realm:us-tichondrius',
      Promise.resolve('stale'),
    );
    expect(_inFlightRefreshesSize()).toBeGreaterThan(0);

    testApp.seed = await truncateAllTables(testApp.db);

    expect(_inFlightRefreshesSize()).toBe(0);
  });
}

describe('Cross-suite state reset (integration)', () => {
  const testAppRef: { current: TestApp } = {
    current: null as unknown as TestApp,
  };

  beforeAll(async () => {
    testAppRef.current = await getTestApp();
  });

  afterEach(async () => {
    testAppRef.current.seed = await truncateAllTables(testAppRef.current.db);
  });

  describeOriginalResets(testAppRef);
  describeModuleSingletonResets(testAppRef);
});
