/**
 * Regression: cross-suite in-memory state is cleared by truncateAllTables.
 *
 * ROK-1059 — full-suite local runs were flaking with 401 on authenticated
 * POSTs issued right after `loginAsAdmin`. Root cause: per-user revocation
 * state written by earlier files (role changes / deletes) outlived the
 * truncate and rejected the freshly re-seeded admin's token. ROK-1823 moved
 * that state from a Redis blocklist to `users.token_version`, read through
 * the in-process auth-user cache.
 *
 * `truncateAllTables` must clear the auth-user cache — the one authoritative
 * "reset module state" entry point between suites — so a version an earlier
 * suite bumped (and cached) cannot reject the next suite's fresh login.
 */
import { getTestApp, type TestApp } from './test-app';
import { truncateAllTables, loginAsAdmin } from './integration-helpers';
import {
  getCachedAuthUser,
  setCachedAuthUser,
} from '../../auth/auth-user-cache';
import { bumpTokenVersion } from '../../auth/token-version.helpers';
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
  it('a token version an earlier suite bumped does not reject a fresh admin login after truncate', async () => {
    const testApp = testAppRef.current;
    const adminId = testApp.seed.adminUser.id;
    // Simulate an earlier suite revoking the seeded admin, and a request
    // that cached the bumped row before the suite ended.
    const bumped = await bumpTokenVersion(testApp.db, adminId);
    setCachedAuthUser(adminId, {
      role: 'admin',
      discordId: null,
      deactivatedAt: null,
      kickedAt: null,
      bannedAt: null,
      banReason: null,
      tokenVersion: bumped,
    });

    // Truncate + re-seed — this is what every suite's afterEach does.
    testApp.seed = await truncateAllTables(testApp.db);

    expect(getCachedAuthUser(adminId)).toBeNull();

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
      tokenVersion: 0,
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
