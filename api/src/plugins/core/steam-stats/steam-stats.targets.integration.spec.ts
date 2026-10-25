/**
 * ROK-1953 L2 — who the nightly refresh targets (T1–T4) and the storage
 * upserts (S1–S3), against a real database. Written by L2, run on the fleet.
 * T1 uses two community hubs; the server-hub variant needs a Pelican fixture
 * and is covered by L3's read spec.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SteamStatsStorageRepository } from './steam-stats-storage.repository';
import { SteamStatsTargetsRepository } from './steam-stats-targets.repository';

const BG3 = 1086940;
const NOT_ENABLED = 892970;
let testApp: TestApp;
let targets: SteamStatsTargetsRepository;
let storage: SteamStatsStorageRepository;

async function makeGame(slug: string, steamAppId: number): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug, steamAppId })
      .returning({ id: schema.games.id }),
    `game ${slug}`,
  );
  return g.id;
}

async function makeHub(
  gameId: number,
  name: string,
  archived = false,
): Promise<number> {
  const [h] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: archived ? 'archived' : 'active',
        archivedAt: archived ? new Date() : null,
      })
      .returning({ id: schema.guilds.id }),
    `hub ${name}`,
  );
  return h.id;
}

async function makeUser(name: string, steamId: string | null): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, steamId })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  return u.id;
}

async function join(guildId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role: 'member' });
}

beforeAll(async () => {
  testApp = await getTestApp();
  targets = testApp.app.get(SteamStatsTargetsRepository);
  storage = testApp.app.get(SteamStatsStorageRepository);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('SteamStatsTargetsRepository (T1–T4)', () => {
  it('T1 — a member of two hubs of an enabled game is targeted once', async () => {
    const game = await makeGame('bg3-int', BG3);
    const [a, b] = [await makeHub(game, 'Hub A'), await makeHub(game, 'Hub B')];
    const user = await makeUser('shared', '76561190000000001');
    await join(a, user);
    await join(b, user);
    const hubs = await targets.liveHubsByApp();
    expect(hubs.get(BG3)).toEqual([a, b]);
    const list = await targets.targetsFor(BG3, hubs.get(BG3) ?? []);
    expect(list.map((t) => t.userId)).toEqual([user]);
  });

  it('T2 — a hub of a non-enabled game with an app id is not targeted', async () => {
    const game = await makeGame('other-int', NOT_ENABLED);
    await join(
      await makeHub(game, 'Other'),
      await makeUser('o', '76561190000000002'),
    );
    expect([...(await targets.liveHubsByApp()).keys()]).toEqual([]);
  });

  it('T3 — an archived hub contributes no target', async () => {
    const game = await makeGame('bg3-arch', BG3);
    await join(
      await makeHub(game, 'Gone', true),
      await makeUser('a', '76561190000000003'),
    );
    expect((await targets.liveHubsByApp()).has(BG3)).toBe(false);
  });

  it('T4 — never-fetched first, then oldest fetched; unlinked users dropped', async () => {
    const game = await makeGame('bg3-order', BG3);
    const hub = await makeHub(game, 'Order');
    const [fresh, stale, never, unlinked] = [
      await makeUser('fresh', '76561190000000004'),
      await makeUser('stale', '76561190000000005'),
      await makeUser('never', '76561190000000006'),
      await makeUser('unlinked', null),
    ];
    for (const u of [fresh, stale, never, unlinked]) await join(hub, u);
    await storage.saveUserStatus(
      fresh,
      BG3,
      'private',
      new Date('2026-10-20T00:00:00Z'),
    );
    await storage.saveUserStatus(
      stale,
      BG3,
      'private',
      new Date('2026-10-01T00:00:00Z'),
    );
    const list = await targets.targetsFor(BG3, [hub]);
    expect(list.map((t) => t.userId)).toEqual([never, stale, fresh]);
  });
});

describe('SteamStatsStorageRepository (S1–S3)', () => {
  const t0 = new Date('2026-09-01T00:00:00Z');
  const rows = (userId: number) =>
    testApp.db
      .select()
      .from(schema.steamUserAchievements)
      .where(
        and(
          eq(schema.steamUserAchievements.userId, userId),
          eq(schema.steamUserAchievements.appId, BG3),
        ),
      );

  it('S1 — an ok refresh keeps the stored unlocked_at and deletes vanished unlocks', async () => {
    const user = await makeUser('s1', '76561190000000007');
    await storage.saveUserOk(
      user,
      BG3,
      [
        { apiName: 'A', unlockedAt: t0 },
        { apiName: 'B', unlockedAt: t0 },
      ],
      t0,
    );
    await storage.saveUserOk(
      user,
      BG3,
      [{ apiName: 'A', unlockedAt: new Date() }],
      new Date(),
    );
    const got = await rows(user);
    expect(got.map((r) => [r.apiName, r.unlockedAt?.toISOString()])).toEqual([
      ['A', t0.toISOString()],
    ]);
    const [status] = await testApp.db
      .select()
      .from(schema.steamUserAppStats)
      .where(eq(schema.steamUserAppStats.userId, user));
    expect(status).toMatchObject({ status: 'ok', unlockedCount: 1 });
  });

  it('S2 — duplicate api names in one fetch do not violate the primary key', async () => {
    const user = await makeUser('s2', '76561190000000008');
    await storage.saveUserOk(
      user,
      BG3,
      [
        { apiName: 'A', unlockedAt: null },
        { apiName: 'A', unlockedAt: t0 },
      ],
      t0,
    );
    expect((await rows(user)).map((r) => r.apiName)).toEqual(['A']);
  });

  it('S3 — a schema refresh deletes achievements Steam no longer lists; a failure keeps them', async () => {
    const ach = (apiName: string) => ({
      apiName,
      name: apiName,
      description: null,
      icon: null,
      hidden: true,
    });
    await storage.saveSchema(
      BG3,
      [ach('X'), ach('Y')],
      new Map([['X', 1.5]]),
      t0,
    );
    await storage.saveSchema(BG3, [ach('X')], null, t0);
    await storage.markSchemaError(BG3);
    const list = await testApp.db.select().from(schema.steamAppAchievements);
    expect(list.map((r) => [r.apiName, r.globalPct])).toEqual([['X', '1.500']]);
    const [app] = await testApp.db.select().from(schema.steamAppStatsApps);
    // Review MAJOR 1: the last SUCCESSFUL fetch time and count survive.
    expect(app).toMatchObject({
      schemaStatus: 'error',
      achievementCount: 1,
      schemaFetchedAt: t0,
    });
    expect(await storage.hasUsableSchema(BG3)).toBe(true);
  });
});
