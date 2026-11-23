/**
 * ROK-2212 — `GET /plugins/wow/guilds/:id/suggested-groups` against the real
 * stack and DB (I1–I10), on the `withSuggestedGroup` seed-guild cast (L14):
 * 7 claimed characters (2 tanks, 1 healer, 4 dps across 6 users, one dps an
 * alt) + 3 unclaimed roster rows (healer, dps, no-role "dps") in ONE listed
 * Forever dungeon read from the catalogue. The service caches one
 * computation per guild for 5 minutes, so every fixture row (incl. the quest
 * rows of I8) is written BEFORE the first read of a guild.
 */
import {
  SuggestedGroupsSchema,
  type SuggestedGroupDto,
  type SuggestedGroupsDto,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import type { SeedGuildResponse } from '../../../../admin/demo-test-guild.controller';
import type { SeededSuggestedGroup } from '../../../../admin/demo-test-guild-suggested-groups.cast';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../../common/testing/narrow';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { clearKnownQuestMemo } from '../../event-forever-progress.query';
import { resolveQuestInstanceIds } from '../../forever-instance-aliases';
import { listInstances } from '../../instance-catalogue/instance-catalogue';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';

const CLASSIC_SLUG = 'world-of-warcraft-classic';
const SEED_ROUTE = '/admin/test/wow/seed-guild';
const ROLE_ORDER = ['tank', 'healer', 'dps', 'dps', 'dps'];
/** I8: one quest per side rule; the Alliance guild keeps two of the three. */
const Q = { horde: 990_201, alliance: 990_202, neutral: 990_203 };

let testApp: TestApp;
let adminToken: string;
let seeded: SeedGuildResponse;
let sg: SeededSuggestedGroup;
let memberToken: string;
let visitorToken: string;
let fetchSpy: jest.SpyInstance;

async function ensureGame(slug: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (found) return found.id;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug })
      .returning(),
    slug,
  );
  return row.id;
}

async function seedGuild(
  name: string,
  extra: Record<string, unknown> = {},
): Promise<SeedGuildResponse> {
  const res = await testApp.request
    .post(SEED_ROUTE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name,
      gameSlug: WOW_FOREVER_GAME_SLUG,
      withSuggestedGroup: true,
      ...extra,
    });
  expect(res.status).toBe(200);
  return res.body as SeedGuildResponse;
}

async function insertGuild(
  name: string,
  opts: Partial<typeof schema.guilds.$inferInsert>,
): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: await ensureGame(WOW_FOREVER_GAME_SLUG),
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: new Date(),
        ...opts,
      })
      .returning(),
    name,
  );
  return g.id;
}

/** I8: the seeded dungeon's quests — Horde-only, Alliance-only, neutral. */
async function seedQuests(instanceId: number, level: number): Promise<void> {
  const dungeonInstanceId = defined(
    resolveQuestInstanceIds(instanceId)[0],
    'quest instance id',
  );
  const base = { expansion: 'classic', questLevel: level, dungeonInstanceId };
  await testApp.db.insert(schema.wowClassicDungeonQuests).values([
    { ...base, questId: Q.horde, name: 'SG Horde', raceRestriction: ['Orc'] },
    {
      ...base,
      questId: Q.alliance,
      name: 'SG Alliance',
      raceRestriction: ['Human'],
    },
    { ...base, questId: Q.neutral, name: 'SG Neutral', raceRestriction: null },
  ]);
}

function tokenFor(user: { userId: number; username: string }): Promise<string> {
  return signTestAccessToken(testApp, {
    sub: user.userId,
    username: user.username,
    role: 'member',
  });
}

function sgGet(guildId: number, token: string, query = 'scope=all') {
  return testApp.request
    .get(`/plugins/wow/guilds/${guildId}/suggested-groups?${query}`)
    .set('Authorization', `Bearer ${token}`);
}

/** A 200 read that parses against the contract. */
async function read(
  guildId: number,
  token: string,
  query = `scope=all&instanceId=${sg.instanceId}`,
): Promise<SuggestedGroupsDto> {
  const res = await sgGet(guildId, token, query);
  expect(res.status).toBe(200);
  const parsed = SuggestedGroupsSchema.safeParse(res.body);
  expect(parsed.success ? null : parsed.error.issues).toBeNull();
  return defined(
    parsed.success ? parsed.data : undefined,
    'suggested-groups body parsed',
  );
}

const members = (groups: readonly SuggestedGroupDto[]) =>
  groups.flatMap((g) => g.members);
const keysOf = (body: SuggestedGroupsDto) =>
  body.groups.map((g) => g.members.map((m) => m.key).join(','));

beforeAll(async () => {
  testApp = await getTestApp();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await ensureGame(WOW_FOREVER_GAME_SLUG);
  await ensureGame(CLASSIC_SLUG);
  seeded = await seedGuild('SG Guild');
  sg = defined(seeded.suggestedGroup, 'suggestedGroup in the seed response');
  await seedQuests(sg.instanceId, sg.level);
  clearKnownQuestMemo();
  memberToken = await tokenFor(seeded.users.gm);
  visitorToken = await tokenFor(seeded.users.outsider);
  fetchSpy = jest.spyOn(globalThis, 'fetch');
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.
afterAll(() => {
  fetchSpy.mockRestore();
  clearKnownQuestMemo();
});

describe('suggested-groups — the withSuggestedGroup seed (L14)', () => {
  it('reads the dungeon span from the catalogue and puts every character inside it', () => {
    const listed = listInstances('wow_forever', 'dungeon');
    const dungeon = defined(
      listed.find((d) => d.id === sg.instanceId),
      'seeded dungeon in the catalogue',
    );
    expect([dungeon.minimumLevel, dungeon.maximumLevel]).toEqual([
      sg.minimumLevel,
      sg.maximumLevel,
    ]);
    expect(sg.level).toBeGreaterThanOrEqual(sg.minimumLevel);
    expect(sg.level).toBeLessThanOrEqual(sg.maximumLevel);
    expect(sg.characters.dps1Alt.userId).toBe(sg.characters.dps1.userId);
  });

  it('is idempotent: a re-seed returns the same characters and roster rows', async () => {
    const again = defined(
      (await seedGuild('SG Guild')).suggestedGroup,
      're-seed',
    );
    expect(again.characters).toEqual(sg.characters);
    expect(again.unclaimed).toEqual(sg.unclaimed);
  });

  it('400 on a non-Forever guild', async () => {
    const res = await testApp.request
      .post(SEED_ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'SG Classic',
        gameSlug: CLASSIC_SLUG,
        withSuggestedGroup: true,
      });
    expect(res.status).toBe(400);
  });
});

describe('suggested-groups — shape and pool (I1, I2, I2b, I2c, I10)', () => {
  it('I1: 200, contract-valid, ≥2 groups of tank/healer/dps×3 in the seeded dungeon', async () => {
    const body = await read(seeded.guildId, memberToken);
    expect(body.groups.length).toBeGreaterThanOrEqual(2);
    for (const g of body.groups) {
      expect(g.instance.id).toBe(sg.instanceId);
      expect(g.members.map((m) => m.role)).toEqual(ROLE_ORDER);
    }
    const top = await read(seeded.guildId, memberToken, 'scope=top');
    expect(top.groups.length).toBeLessThanOrEqual(3);
    const ids = top.groups.map((g) => g.instance.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('I2: the unclaimed healer is picked as its own player (characterId null, key m<memberId>)', async () => {
    const body = await read(seeded.guildId, memberToken);
    const unclaimed = members(body.groups).filter(
      (m) => m.characterId === null,
    );
    expect(unclaimed.map((m) => m.key)).toContain(sg.unclaimed.healer.key);
    for (const m of unclaimed) {
      expect(m.key).toBe(`m${m.memberId}`);
      expect(m.userId).toBeNull();
    }
    expect(body.pool.unclaimed).toBeGreaterThanOrEqual(2);
  });

  it('I2b: no group repeats a player — distinct users, distinct unclaimed keys, never main + alt', async () => {
    const body = await read(seeded.guildId, memberToken);
    const { dps1, dps1Alt } = sg.characters;
    for (const g of body.groups) {
      const users = g.members.flatMap((m) =>
        m.userId === null ? [] : [m.userId],
      );
      expect(new Set(users).size).toBe(users.length);
      const keys = g.members.map((m) => m.key);
      expect(new Set(keys).size).toBe(5);
      const chars = g.members.map((m) => m.characterId);
      expect(
        chars.includes(dps1.characterId) && chars.includes(dps1Alt.characterId),
      ).toBe(false);
    }
  });

  it('I2c: the no-role unclaimed row is skipped and counted, never placed', async () => {
    const body = await read(seeded.guildId, memberToken);
    expect(members(body.groups).map((m) => m.key)).not.toContain(
      sg.unclaimed.noRole.key,
    );
    expect(body.pool.skippedNoRole).toBeGreaterThanOrEqual(1);
  });

  it('I10: a member viewer sees each claimed character with its owner userId', async () => {
    const body = await read(seeded.guildId, memberToken);
    const ownerOf = new Map(
      Object.values(sg.characters).map((c) => [c.characterId, c.userId]),
    );
    const claimed = members(body.groups).filter((m) => m.characterId !== null);
    expect(claimed.length).toBeGreaterThan(0);
    for (const m of claimed) {
      expect({ key: m.key, userId: m.userId }).toEqual({
        key: m.key,
        userId: ownerOf.get(m.key),
      });
    }
  });
});

describe('suggested-groups — access (I3–I6)', () => {
  it('I3: a Classic wow_guild and a Forever community hub are 404', async () => {
    const classic = await insertGuild('SG Classic Hub', {
      gameId: await ensureGame(CLASSIC_SLUG),
    });
    const community = await insertGuild('SG Community', {
      kind: 'game_community',
    });
    for (const gid of [classic, community]) {
      const res = await sgGet(gid, adminToken);
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('groups');
    }
  });

  it('I4: a hidden hub is 404 for a non-staff non-member; staff get 200', async () => {
    const hidden = await insertGuild('SG Hidden', { hiddenAt: new Date() });
    const res = await sgGet(hidden, visitorToken);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('groups');
    await read(hidden, adminToken, 'scope=top');
  });

  it('I5: a signed-in visitor gets the same groups with every userId null', async () => {
    const asMember = await read(seeded.guildId, memberToken);
    const asVisitor = await read(seeded.guildId, visitorToken);
    expect(keysOf(asVisitor)).toEqual(keysOf(asMember));
    const leaked = members(asVisitor.groups).filter((m) => m.userId !== null);
    expect(leaked).toEqual([]);
  });

  it('I6: plugin inactive → 403 from PluginActiveGuard', async () => {
    const registry = testApp.app.get(PluginRegistryService);
    await registry.deactivate(WOW_COMMON_MANIFEST.id);
    try {
      const res = await sgGet(seeded.guildId, memberToken);
      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('groups');
    } finally {
      await registry.activate(WOW_COMMON_MANIFEST.id);
    }
  });
});

describe('suggested-groups — query validation (I7)', () => {
  it('400 on a bad scope, a non-integer instanceId and an unknown key', async () => {
    for (const q of ['scope=bogus', 'instanceId=abc', 'scope=top&foo=1']) {
      const res = await sgGet(seeded.guildId, memberToken, q);
      expect({ q, status: res.status }).toEqual({ q, status: 400 });
    }
  });

  it('a raid instanceId yields no groups (lane B APPLY: filter, not 400)', async () => {
    const raid = nonEmpty(
      listInstances('wow_forever', 'raid'),
      'Forever raids',
    )[0];
    const body = await read(
      seeded.guildId,
      memberToken,
      `scope=all&instanceId=${raid.id}`,
    );
    expect(body.groups).toEqual([]);
  });
});

describe('suggested-groups — shared quests (I8)', () => {
  it('counts the Alliance + neutral quests only (the Horde-only one is excluded)', async () => {
    const body = await read(seeded.guildId, memberToken);
    const scored = body.groups.filter((g) => g.sharedQuests !== null);
    expect(scored.length).toBeGreaterThan(0);
    // Every group here has ≥3 claimed members with an empty Armory quest list.
    expect(scored.map((g) => g.sharedQuests)).toEqual(scored.map(() => 2));
  });
});

describe('suggested-groups — no outbound network (I9)', () => {
  it('a fresh computation makes zero fetch calls', async () => {
    const fresh = await seedGuild('SG Fresh');
    const freshSg = defined(fresh.suggestedGroup, 'fresh suggestedGroup');
    fetchSpy.mockClear();
    const body = await read(
      fresh.guildId,
      memberToken,
      `scope=all&instanceId=${freshSg.instanceId}`,
    );
    expect(body.groups.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
