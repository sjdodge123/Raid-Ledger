/**
 * ROK-1797 — per-game notification mute routes (slice L2).
 *
 *   POST   /games/:id/notification-mute   mute (404 on unknown game)
 *   DELETE /games/:id/notification-mute   unmute (no 404 without a row)
 *   GET    /notifications/game-mutes      the viewer's muted games
 *
 * Plus `notificationsMuted` on the interest response, heart independence,
 * and the `GET /games/:id` route-collision check.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { defined } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';

function describeGameNotificationMuteRoutes() {
  let testApp: TestApp;
  let token: string;

  const insertGame = async (name: string, coverUrl: string | null = null) => {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-'), coverUrl })
      .returning();
    return defined(g, `inserted game ${name}`);
  };

  const muteRows = (gameId: number) =>
    testApp.db
      .select()
      .from(schema.gameNotificationMutes)
      .where(eq(schema.gameNotificationMutes.gameId, gameId));

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    testApp = await getTestApp();
    token = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    token = await loginAsAdmin(testApp.request, testApp.seed);
  });

  it('mutes idempotently and persists one row', async () => {
    const game = await insertGame('Mute Game');
    const url = `/games/${game.id}/notification-mute`;

    const first = await testApp.request.post(url).set(auth());
    const second = await testApp.request.post(url).set(auth());

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ gameId: game.id, muted: true });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ gameId: game.id, muted: true });
    const rows = await muteRows(game.id);
    expect(rows.map((r) => r.userId)).toEqual([testApp.seed.adminUser.id]);
  });

  it('unmutes, and a repeat unmute is still 200', async () => {
    const game = await insertGame('Unmute Game');
    const url = `/games/${game.id}/notification-mute`;
    await testApp.request.post(url).set(auth());

    const first = await testApp.request.delete(url).set(auth());
    const second = await testApp.request.delete(url).set(auth());

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ gameId: game.id, muted: false });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ gameId: game.id, muted: false });
    expect(await muteRows(game.id)).toEqual([]);
  });

  it('returns 404 when muting an unknown game', async () => {
    const res = await testApp.request
      .post('/games/999999/notification-mute')
      .set(auth());

    expect(res.status).toBe(404);
  });

  it('returns 401 on every route when signed out', async () => {
    const game = await insertGame('Signed Out Game');
    const url = `/games/${game.id}/notification-mute`;

    const statuses = [
      (await testApp.request.post(url)).status,
      (await testApp.request.delete(url)).status,
      (await testApp.request.get('/notifications/game-mutes')).status,
    ];

    expect(statuses).toEqual([401, 401, 401]);
    expect(await muteRows(game.id)).toEqual([]);
  });

  it('lists muted games by name with slug, cover and mutedAt', async () => {
    const zeta = await insertGame('Zeta Quest', 'https://img.test/z.jpg');
    const alpha = await insertGame('Alpha Quest');
    await insertGame('Not Muted Quest');
    for (const g of [zeta, alpha]) {
      await testApp.request
        .post(`/games/${g.id}/notification-mute`)
        .set(auth());
    }

    const res = await testApp.request
      .get('/notifications/game-mutes')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          gameId: alpha.id,
          name: 'Alpha Quest',
          slug: 'alpha-quest',
          coverUrl: null,
          mutedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
        {
          gameId: zeta.id,
          name: 'Zeta Quest',
          slug: 'zeta-quest',
          coverUrl: 'https://img.test/z.jpg',
          mutedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      ],
    });
  });

  it('carries notificationsMuted on the interest response', async () => {
    const game = await insertGame('Interest Mute Game');
    const interestUrl = `/games/${game.id}/interest`;

    const before = await testApp.request.get(interestUrl).set(auth());
    await testApp.request
      .post(`/games/${game.id}/notification-mute`)
      .set(auth());
    const after = await testApp.request.get(interestUrl).set(auth());

    expect(before.status).toBe(200);
    expect(before.body.notificationsMuted).toBe(false);
    expect(after.status).toBe(200);
    expect(after.body.notificationsMuted).toBe(true);
  });

  it('keeps the mute through heart and un-heart', async () => {
    const game = await insertGame('Heart Independent Game');
    await testApp.request
      .post(`/games/${game.id}/notification-mute`)
      .set(auth());

    const heart = await testApp.request
      .post(`/games/${game.id}/want-to-play`)
      .set(auth());
    const unheart = await testApp.request
      .delete(`/games/${game.id}/want-to-play`)
      .set(auth());

    expect(heart.body.notificationsMuted).toBe(true);
    expect(unheart.body.notificationsMuted).toBe(true);
    expect(await muteRows(game.id)).toHaveLength(1);
  });

  it('still resolves GET /games/:id (no route collision)', async () => {
    const game = await insertGame('Collision Check Game');

    const res = await testApp.request.get(`/games/${game.id}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(game.id);
  });
}

describe('Game notification mute routes (integration)', () =>
  describeGameNotificationMuteRoutes());
