/**
 * ROK-1796 — un-hearting a game must stick across the daily Steam syncs, and a
 * Steam-only tie to a game must show as the user's own heart.
 *
 * The Steam HTTP boundary is patched with `jest.spyOn` on the live module
 * namespace (see steam-auth.integration.spec.ts for why `jest.mock` does not
 * take effect in the integration suite).
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { findGameAffinityRecipients } from '../notifications/game-affinity-recipients.helpers';
import { SteamService } from './steam.service';
import { SteamWishlistService } from './steam-wishlist.service';
import * as steamHttp from './steam-http.util';

const STEAM_ID = '76561198000000001';
const APP_ID = 1086940;

function stubSteam(): void {
  jest.spyOn(steamHttp, 'getPlayerSummary').mockResolvedValue({
    steamid: STEAM_ID,
    personaname: 'public-user',
    profileurl: '',
    avatar: '',
    avatarmedium: '',
    avatarfull: '',
    communityvisibilitystate: 3,
  });
  jest
    .spyOn(steamHttp, 'getOwnedGames')
    .mockResolvedValue([
      { appid: APP_ID, name: 'Unheart Game', playtime_forever: 600 },
    ]);
  jest
    .spyOn(steamHttp, 'getWishlist')
    .mockResolvedValue([{ appid: APP_ID, date_added: 1000 }]);
}

function describeUnheartSuppression() {
  let testApp: TestApp;
  let token: string;
  let userId: number;
  let gameId: number;

  const syncBoth = async (): Promise<void> => {
    await testApp.app.get(SteamService).syncLibrary(userId);
    await testApp.app.get(SteamWishlistService).syncWishlist(userId);
  };

  const sourcesFor = async (): Promise<string[]> => {
    const rows = await testApp.db
      .select({ source: schema.gameInterests.source })
      .from(schema.gameInterests)
      .where(
        and(
          eq(schema.gameInterests.userId, userId),
          eq(schema.gameInterests.gameId, gameId),
        ),
      );
    return rows.map((r) => r.source).sort();
  };

  const suppressionCount = async (): Promise<number> => {
    const rows = await testApp.db
      .select()
      .from(schema.gameInterestSuppressions)
      .where(
        and(
          eq(schema.gameInterestSuppressions.userId, userId),
          eq(schema.gameInterestSuppressions.gameId, gameId),
        ),
      );
    return rows.length;
  };

  const getInterest = async () =>
    testApp.request
      .get(`/games/${gameId}/interest`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
    token = await loginAsAdmin(testApp.request, testApp.seed);
    userId = testApp.seed.adminUser.id;
    await testApp.app.get(SettingsService).setSteamApiKey('it-steam-key');
    await testApp.db
      .update(schema.users)
      .set({ steamId: STEAM_ID })
      .where(eq(schema.users.id, userId));
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Unheart Game',
        slug: 'unheart-game',
        steamAppId: APP_ID,
      })
      .returning({ id: schema.games.id });
    if (!game) throw new Error('game insert returned no row');
    gameId = game.id;
    stubSteam();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Steam-only tie reports wantToPlay: true without changing public counts', async () => {
    await syncBoth();
    expect(await sourcesFor()).toEqual(['steam_library', 'steam_wishlist']);

    const res = await getInterest();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      wantToPlay: true,
      source: 'steam',
      count: 0,
    });
    expect(res.body.ownerCount).toBe(1);
    expect(res.body.wishlistedCount).toBe(1);
  });

  it('un-heart survives a library + wishlist re-sync and drops the user from interest recipients', async () => {
    await syncBoth();
    const del = await testApp.request
      .delete(`/games/${gameId}/want-to-play`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.wantToPlay).toBe(false);
    expect(await suppressionCount()).toBe(1);

    await syncBoth();

    expect(await sourcesFor()).toEqual([]);
    const recipients = await findGameAffinityRecipients(testApp.db, gameId, {
      interestsOnly: true,
    });
    expect(recipients).not.toContain(userId);
    expect((await getInterest()).body.wantToPlay).toBe(false);
  });

  it('a manual re-heart clears the suppression so Steam rows sync again', async () => {
    await syncBoth();
    await testApp.request
      .delete(`/games/${gameId}/want-to-play`)
      .set('Authorization', `Bearer ${token}`);
    expect(await suppressionCount()).toBe(1);

    const post = await testApp.request
      .post(`/games/${gameId}/want-to-play`)
      .set('Authorization', `Bearer ${token}`);
    expect(post.status).toBe(200);
    expect(await suppressionCount()).toBe(0);

    await syncBoth();
    expect(await sourcesFor()).toEqual([
      'manual',
      'steam_library',
      'steam_wishlist',
    ]);
  });
}

describe('Steam un-heart suppression (ROK-1796)', describeUnheartSuppression);
