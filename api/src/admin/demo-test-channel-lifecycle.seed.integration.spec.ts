/**
 * ROK-1428 — `seedServerHubWithoutChannel` makes the seeding admin a live
 * manual member of the game_server hub, so `/guilds/<hubId>` and its Discord
 * channel picker open for them. FLEET-ONLY (real Postgres).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { seedServerHubWithoutChannel } from './demo-test-channel-lifecycle.seed';

let t: TestApp;

async function insertGame(): Promise<{ id: number; name: string }> {
  const [g] = nonEmpty(
    await t.db
      .insert(schema.games)
      .values({ name: 'Seed Hub Game', slug: `seed-hub-${Date.now()}` })
      .returning({ id: schema.games.id, name: schema.games.name }),
    'game',
  );
  return g;
}

function membersOf(hubId: number) {
  return t.db
    .select()
    .from(schema.hubServerMembers)
    .where(eq(schema.hubServerMembers.guildId, hubId));
}

beforeAll(async () => {
  t = await getTestApp();
});

afterEach(async () => {
  t.seed = await truncateAllTables(t.db);
});

it('joins the seeding user to the hub as a live manual member', async () => {
  const game = await insertGame();
  const userId = t.seed.adminUser.id;
  const hubId = await seedServerHubWithoutChannel(t.db, game, userId);
  const rows = await membersOf(hubId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ userId, source: 'manual', leftAt: null });
  expect(rows[0]?.joinedAt).toBeInstanceOf(Date);
});

it('is idempotent: a re-seed keeps one hub and one member row', async () => {
  const game = await insertGame();
  const userId = t.seed.adminUser.id;
  const first = await seedServerHubWithoutChannel(t.db, game, userId);
  const second = await seedServerHubWithoutChannel(t.db, game, userId);
  expect(second).toBe(first);
  expect(await membersOf(first)).toHaveLength(1);
});
