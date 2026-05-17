/**
 * Steam Auth — manual sync endpoint integration tests (ROK-1307).
 *
 * These are the TDD-RED gate specs for the story: each case codifies an
 * end-to-end behavior the dev must make pass.
 *
 * Failure modes verified against current HEAD (`030e67a8`):
 *
 *   AC-1 — `POST /auth/steam/sync` with an unlinked user MUST return 400
 *          with `{ statusCode, message, error }` body. Current HEAD throws a
 *          bare `Error('User has no linked Steam account')` → NestJS converts
 *          it to a 500 → @sentry/nestjs OTel auto-instrumentation captures
 *          the event → Sentry burst (6 events in 2 min from a single user).
 *          Same shape required for `/auth/steam/sync-wishlist`.
 *
 *   AC-7 — When the user IS linked but their Steam profile privacy is set to
 *          private (communityvisibilitystate !== 3), the endpoint MUST return
 *          400 with an actionable `'Steam profile is private — …'` message.
 *          Current HEAD silently returns 200 with `{ matched: 0 }`, leaving
 *          the user with no idea what is wrong → falls into the unlink-race
 *          downstream of B (see spec RCA §"How the user got there").
 *
 * Mocking strategy:
 *
 *   - `jest.mock('./steam-http.util')` replaces the HTTP boundary. Tests
 *     control `getPlayerSummary` per-case to simulate public vs private
 *     profiles. `getOwnedGames` is mocked too so the happy-path control case
 *     can land cleanly even though the spec doesn't drive it through to a
 *     real Steam call.
 *   - The real `SteamService` / `SteamWishlistService` / `SteamAuthController`
 *     / `SettingsService` are exercised end-to-end through the NestJS app.
 *     That's deliberate: AC-1 is about which exception type the controller
 *     surfaces, AC-7 is about whether the service's private-profile branch
 *     short-circuits with a throw or a silent empty return. Both must be
 *     observed at the HTTP boundary to count as fixed.
 *
 * Per-spec-file VM isolation note (see api/src/common/testing/test-app.ts
 * file-level comment): each `*.integration.spec.ts` evaluates this module's
 * `jest.mock` in its own VM context. Other integration specs sharing the
 * testApp singleton are NOT affected by the mock declared here.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import * as steamHttp from './steam-http.util';

const STEAM_ID = '76561198000000001';
const STEAM_API_KEY = 'integration-test-steam-key';

function describeSteamAuthSync() {
  let testApp: TestApp;
  let token: string;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
    token = await loginAsAdmin(testApp.request, testApp.seed);

    // Configure a Steam API key so `validateSyncPrereqs` only fails on the
    // steamId check. Without this, the unlinked-user case would fail on the
    // *second* throw (`'Steam API key is not configured'`) for the wrong
    // reason once AC-1 lands and short-circuits on the first throw — both
    // bare `Error`s today get converted to 500, so the unconfigured-key
    // pathway happens to mask the unlinked-user pathway.
    const settings = testApp.app.get(SettingsService);
    await settings.setSteamApiKey(STEAM_API_KEY);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /auth/steam/sync (AC-1 + AC-7)', () => {
    it('returns 400 BadRequestException when the user has no linked Steam account', async () => {
      // Seed-baseline admin has no Steam linked — users.steam_id IS NULL.
      const res = await testApp.request
        .post('/auth/steam/sync')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        message: 'Steam account not linked',
        error: 'Bad Request',
      });
    });

    it('returns 400 with actionable message when the linked Steam profile is private', async () => {
      // Link Steam for the admin user.
      await testApp.db
        .update(schema.users)
        .set({ steamId: STEAM_ID })
        .where(eq(schema.users.id, testApp.seed.adminUser.id));

      // Simulate Steam reporting the profile as private
      // (communityvisibilitystate !== 3). HEAD silently returns [] here and
      // produces a 200 OK with `matched: 0`; AC-7 requires a 400 instead.
      //
      // ROK-1307 dev follow-up: `jest.mock('./steam-http.util')` does NOT
      // take effect because the integration suite's `setupFilesAfterEnv`
      // imports `AppModule` → `SteamService` → `./steam-http.util` BEFORE
      // the spec file's hoisted mock is registered. Patch the live module
      // namespace via `jest.spyOn` instead, which DOES intercept the
      // already-bound import on the service side.
      jest.spyOn(steamHttp, 'getPlayerSummary').mockResolvedValue({
        steamid: STEAM_ID,
        personaname: 'private-user',
        profileurl: '',
        avatar: '',
        avatarmedium: '',
        avatarfull: '',
        communityvisibilitystate: 1,
      });
      jest.spyOn(steamHttp, 'getOwnedGames').mockResolvedValue([]);

      const res = await testApp.request
        .post('/auth/steam/sync')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
      });
      expect(res.body.message).toEqual(
        expect.stringContaining('Steam profile is private'),
      );
    });
  });

  describe('POST /auth/steam/sync-wishlist (AC-1 + AC-7 symmetric)', () => {
    it('returns 400 BadRequestException when the user has no linked Steam account', async () => {
      const res = await testApp.request
        .post('/auth/steam/sync-wishlist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        message: 'Steam account not linked',
        error: 'Bad Request',
      });
    });

    it('returns 400 with actionable message when the linked Steam profile is private', async () => {
      await testApp.db
        .update(schema.users)
        .set({ steamId: STEAM_ID })
        .where(eq(schema.users.id, testApp.seed.adminUser.id));

      jest.spyOn(steamHttp, 'getPlayerSummary').mockResolvedValue({
        steamid: STEAM_ID,
        personaname: 'private-user',
        profileurl: '',
        avatar: '',
        avatarmedium: '',
        avatarfull: '',
        communityvisibilitystate: 2, // friends-only counts as not-public
      });
      jest.spyOn(steamHttp, 'getWishlist').mockResolvedValue([]);

      const res = await testApp.request
        .post('/auth/steam/sync-wishlist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
      });
      expect(res.body.message).toEqual(
        expect.stringContaining('Steam profile is private'),
      );
    });
  });
}

describe(
  'Steam manual sync endpoints (integration, ROK-1307)',
  describeSteamAuthSync,
);
