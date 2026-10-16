/**
 * ROK-1796 — un-hearting a game must stick (heart off, no interest DMs) across
 * the daily Steam syncs WITHOUT erasing Steam ownership/playtime: un-heart
 * deletes only heart-source rows and records a suppression that every
 * "is this user interested" read honours.
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
import { findRecipients as findReminderRecipients } from '../notifications/recruitment-reminder.helpers';
import { findStandalonePollRecipients } from '../lineups/standalone-poll/standalone-poll-recipients.helpers';
import { getTimeSuggestions } from '../events/event-plans-time.helpers';
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

  const batchWantToPlay = async (): Promise<unknown> => {
    const res = await testApp.request
      .get(`/games/interest/batch?ids=${gameId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.data[String(gameId)];
  };

  const unheart = async (): Promise<void> => {
    const del = await testApp.request
      .delete(`/games/${gameId}/want-to-play`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.wantToPlay).toBe(false);
  };

  const reheart = async (): Promise<void> => {
    const post = await testApp.request
      .post(`/games/${gameId}/want-to-play`)
      .set('Authorization', `Bearer ${token}`);
    expect(post.status).toBe(200);
  };

  /** Interest-half recipients: game-alert/LFG, recruitment reminder, standalone poll. */
  const isRecipient = async (): Promise<{
    lfg: boolean;
    reminder: boolean;
    poll: boolean;
  }> => {
    const lfg = await findGameAffinityRecipients(testApp.db, gameId, {
      interestsOnly: true,
    });
    const reminder = await findReminderRecipients(testApp.db, gameId, -1, -1);
    const poll = await findStandalonePollRecipients(testApp.db, gameId, -1);
    return {
      lfg: lfg.includes(userId),
      reminder: reminder.includes(userId),
      poll: poll.includes(userId),
    };
  };

  /** Event-plan time suggestions' interestedPlayerCount for the game. */
  const interestedPlayerCount = async (): Promise<number> => {
    const res = await getTimeSuggestions(
      testApp.db,
      testApp.app.get(SettingsService),
      gameId,
    );
    return res.interestedPlayerCount;
  };

  /** Seed the pre-fix state: a heart row plus an un-heart suppression. */
  const seedHeartWithSuppression = async (source: string): Promise<void> => {
    await testApp.db
      .insert(schema.gameInterests)
      .values({ userId, gameId, source });
    await testApp.db
      .insert(schema.gameInterestSuppressions)
      .values({ userId, gameId });
  };

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

  it('(a) Steam-only owner has a lit heart and is an interest recipient', async () => {
    await syncBoth();
    expect(await sourcesFor()).toEqual(['steam_library', 'steam_wishlist']);

    const res = await getInterest();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      wantToPlay: true,
      source: 'steam',
      count: 0,
    });
    expect(await batchWantToPlay()).toEqual({ wantToPlay: true, count: 0 });
    expect(await isRecipient()).toEqual({
      lfg: true,
      reminder: true,
      poll: true,
    });
  });

  it('(b) un-heart keeps Steam ownership but turns the heart and interest DMs off', async () => {
    await syncBoth();
    await unheart();

    expect(await suppressionCount()).toBe(1);
    expect(await sourcesFor()).toEqual(['steam_library', 'steam_wishlist']);
    const res = await getInterest();
    expect(res.body).toMatchObject({
      wantToPlay: false,
      ownerCount: 1,
      wishlistedCount: 1,
    });
    expect(await batchWantToPlay()).toEqual({ wantToPlay: false, count: 0 });
    expect(await isRecipient()).toEqual({
      lfg: false,
      reminder: false,
      poll: false,
    });
  });

  it('(c) the un-heart survives a library + wishlist re-sync', async () => {
    await syncBoth();
    await unheart();

    await syncBoth();

    expect(await sourcesFor()).toEqual(['steam_library', 'steam_wishlist']);
    expect((await getInterest()).body.wantToPlay).toBe(false);
    expect(await batchWantToPlay()).toEqual({ wantToPlay: false, count: 0 });
    expect(await isRecipient()).toEqual({
      lfg: false,
      reminder: false,
      poll: false,
    });
  });

  it('(d) un-heart → manual re-heart → un-heart with no sync between stays suppressed', async () => {
    await syncBoth();
    await unheart();
    await reheart();
    expect(await suppressionCount()).toBe(0);

    await unheart();

    expect(await suppressionCount()).toBe(1);
    expect(await sourcesFor()).toEqual(['steam_library', 'steam_wishlist']);
    expect(await isRecipient()).toEqual({
      lfg: false,
      reminder: false,
      poll: false,
    });
  });

  it('(e) a manual re-heart makes the user a recipient again', async () => {
    await syncBoth();
    await unheart();

    await reheart();
    await syncBoth();

    expect(await suppressionCount()).toBe(0);
    expect(await sourcesFor()).toEqual([
      'manual',
      'steam_library',
      'steam_wishlist',
    ]);
    expect((await getInterest()).body).toMatchObject({
      wantToPlay: true,
      source: 'manual',
      count: 1,
    });
    expect(await isRecipient()).toEqual({
      lfg: true,
      reminder: true,
      poll: true,
    });
  });

  it('(f) legacy heart + stale suppression (no Steam rows) still counts as hearted', async () => {
    await seedHeartWithSuppression('manual');

    expect((await getInterest()).body).toMatchObject({
      wantToPlay: true,
      source: 'manual',
      count: 1,
    });
    expect(await batchWantToPlay()).toEqual({ wantToPlay: true, count: 1 });
    expect(await isRecipient()).toEqual({
      lfg: true,
      reminder: true,
      poll: true,
    });
  });

  it('(g) a concurrent Discord heart beside a suppression wins over Steam masking', async () => {
    await syncBoth();
    await seedHeartWithSuppression('discord');

    expect((await getInterest()).body.wantToPlay).toBe(true);
    expect(await isRecipient()).toEqual({
      lfg: true,
      reminder: true,
      poll: true,
    });
  });

  it('(h) un-hearted Steam owner drops out of the event-plan interestedPlayerCount', async () => {
    await syncBoth();
    await testApp.db
      .insert(schema.gameTimeTemplates)
      .values({ userId, dayOfWeek: 2, startHour: 20 });
    expect(await interestedPlayerCount()).toBe(1);

    await unheart();
    expect(await interestedPlayerCount()).toBe(0);

    await reheart();
    // heart + library + wishlist rows: one distinct interested player
    expect(await interestedPlayerCount()).toBe(1);
  });
}

describe('Steam un-heart suppression (ROK-1796)', describeUnheartSuppression);
