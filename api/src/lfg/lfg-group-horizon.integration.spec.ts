/**
 * ROK-2352 P2-4 — a group's horizon is read from THAT group's hands.
 *
 * A `now` hand in `dungeon:36` must not make a board Join on `raid:409`
 * inherit `now` (a 30/60-minute clock) when the raid group only holds `week`
 * hands. A null scope (the fold) still reads every hand of the game.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { readGroupHorizon } from './lfg-group-horizon.helpers';

let testApp: TestApp;
let gameId: number;
const NOW = new Date();

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'WoW Horizon', slug: 'wow-2352-horizon', igdbId: null })
      .returning({ id: schema.games.id }),
    'game',
  );
  gameId = game.id;
  await testApp.db.insert(schema.lfgIntents).values({
    userId: testApp.seed.adminUser.id,
    gameId,
    urgency: 'now',
    ttlMinutes: 60,
    expiresAt: new Date(NOW.getTime() + 45 * 60_000),
    groupKey: 'dungeon:36',
  });
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('readGroupHorizon scope (ROK-2352 P2-4)', () => {
  it('another group’s now hand leaves this group on week', async () => {
    const horizon = await readGroupHorizon(testApp.db, gameId, NOW, 'raid:409');

    expect(horizon.urgency).toBe('week');
  });

  it('the group holding the now hand reads now', async () => {
    const horizon = await readGroupHorizon(
      testApp.db,
      gameId,
      NOW,
      'dungeon:36',
    );

    expect(horizon).toMatchObject({ urgency: 'now', ttlMinutes: 60 });
  });

  it('the fold (null scope) still reads every hand of the game', async () => {
    const horizon = await readGroupHorizon(testApp.db, gameId, NOW, null);

    expect(horizon.urgency).toBe('now');
  });
});
