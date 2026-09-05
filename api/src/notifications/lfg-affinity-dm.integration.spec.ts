/**
 * ROK-1471 D11/T14 — LFG invite DMs against a real DB + real Redis.
 *
 * The unit spec pins the branching; this pins the thing only real
 * infrastructure can prove: the dedup key is per (game, user) and survives
 * a second `LFM_REACHED` wave for the same group.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { setLfgBoardEnabled } from '../settings/settings-lfg-board.helpers';
import { createGame, heartGame } from '../lfg/lfg.integration.spec-helpers';
import { LFG_EXPIRY_DAYS } from '../lfg/lfg.constants';
import * as schema from '../drizzle/schema';
import { LfgAffinityDmService } from './lfg-affinity-dm.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('LFG affinity DMs (integration)', () => {
  let testApp: TestApp;
  let service: LfgAffinityDmService;
  let redis: {
    keys: (pattern: string) => Promise<string[]>;
    del: (...keys: string[]) => Promise<number>;
  };

  /** Count the `lfg_invite` rows a user holds for a specific game. */
  async function inviteRows(userId: number, gameId: number): Promise<number> {
    const rows = await testApp.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM notifications
      WHERE user_id = ${userId}
        AND type = 'lfg_invite'
        AND (payload->>'gameId')::int = ${gameId}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(LfgAffinityDmService);
    redis = testApp.app.get(REDIS_CLIENT);
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    const keys = await redis.keys('lfg-invite:*');
    if (keys.length > 0) await redis.del(...keys);
    await setLfgBoardEnabled(testApp.app.get(SettingsService), true);
  });

  it('writes exactly one invite per (game, user) across two waves (T14)', async () => {
    const userId = testApp.seed.adminUser.id;
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await heartGame(testApp, userId, game.id);

    await service.handleLfmReached({ gameId: game.id, activeCount: 2 });
    await service.handleLfmReached({ gameId: game.id, activeCount: 3 });

    expect(await inviteRows(userId, game.id)).toBe(1);
  });

  it('keys the dedup per game — a second game invites again', async () => {
    const userId = testApp.seed.adminUser.id;
    const first = await createGame(testApp, 'Deep Rock Galactic');
    const second = await createGame(testApp, 'Helldivers 2');
    await heartGame(testApp, userId, first.id);
    await heartGame(testApp, userId, second.id);

    await service.handleLfmReached({ gameId: first.id, activeCount: 2 });
    await service.handleLfmReached({ gameId: second.id, activeCount: 2 });

    expect(await inviteRows(userId, first.id)).toBe(1);
    expect(await inviteRows(userId, second.id)).toBe(1);
  });

  it('never invites a subscriber who already holds a live intent', async () => {
    const userId = testApp.seed.adminUser.id;
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await heartGame(testApp, userId, game.id);
    await testApp.db.insert(schema.lfgIntents).values({
      userId,
      gameId: game.id,
      status: 'active',
      visibility: 'local',
      expiresAt: new Date(Date.now() + LFG_EXPIRY_DAYS * DAY_MS),
    });

    await service.handleLfmReached({ gameId: game.id, activeCount: 2 });

    expect(await inviteRows(userId, game.id)).toBe(0);
  });

  it('is inert while the board toggle is off (D1)', async () => {
    const userId = testApp.seed.adminUser.id;
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await heartGame(testApp, userId, game.id);
    await setLfgBoardEnabled(testApp.app.get(SettingsService), false);

    await service.handleLfmReached({ gameId: game.id, activeCount: 2 });

    expect(await inviteRows(userId, game.id)).toBe(0);
  });
});
