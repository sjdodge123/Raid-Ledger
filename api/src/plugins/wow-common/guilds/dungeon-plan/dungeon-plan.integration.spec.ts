/**
 * ROK-2214 — `GET /plugins/wow/guilds/:id/dungeon-plan` through the real HTTP
 * stack and DB (I1–I11): access (visible / hidden / non-Forever / community
 * hubs), instance + query validation, roster-only characters (dropped ids
 * echoed, none of their data returned), the guild-side quest filter with the
 * characters' shared side as fallback, readiness parity with the event
 * readiness endpoint, level fit against the catalogue range (read from the
 * catalogue, never hard-coded — R2), and no outbound network.
 */
import {
  AddonCharSnapshotDataSchema,
  DungeonPlanSchema,
  type DungeonPlanDto,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { clearKnownQuestMemo } from '../../event-forever-progress.query';
import { resolveQuestInstanceIds } from '../../forever-instance-aliases';
import {
  getInstance,
  listInstances,
} from '../../instance-catalogue/instance-catalogue';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const CLASSIC_SLUG = 'world-of-warcraft-classic';
const SNAP = new Date('2026-11-01T12:00:00.000Z');
const HOUR = 3600_000;

/** Quest ids: two Horde-only, one Alliance-only, two neutral. */
const Q = {
  horde1: 990101,
  horde2: 990102,
  alliance: 990103,
  neutralNull: 990104,
  neutralEmpty: 990105,
} as const;
const ALL_QUESTS = Object.values(Q).sort((a, b) => a - b);
const NEUTRAL = [Q.neutralNull, Q.neutralEmpty];

/** A listed Forever dungeon whose range leaves room below it (R2). */
const DUNGEON = defined(
  listInstances('wow_forever', 'dungeon').find((r) => r.minimumLevel > 1),
  'forever dungeon',
);
const RAID = defined(listInstances('wow_forever', 'raid')[0], 'forever raid');

let testApp: TestApp;
let adminToken: string;
let foreverGame: number;
let classicGame: number;
const guilds = {} as Record<
  'alliance' | 'horde' | 'neutral' | 'empty' | 'other' | 'hidden',
  number
>;
type Who = 'lead' | 'outsider' | 'hordeA' | 'hordeB' | 'otherOwner';
const users = {} as Record<Who, { id: number; token: string }>;
const chars = {} as Record<
  'below' | 'inRange' | 'above' | 'noLevel' | 'orcAlt' | 'other' | 'wouldBe',
  string
>;
const hordeChars: string[] = [];
let fetchSpy: jest.SpyInstance;

async function ensureGame(slug: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (found) return found.id;
  const [row] = await testApp.db
    .insert(schema.games)
    .values({ name: slug, slug })
    .returning();
  return defined(row, slug).id;
}

async function insertGuild(
  name: string,
  opts: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverGame,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
        ...opts,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function seedUser(who: Who): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `dp-${who}`, username: who, role: 'member' })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: who,
    role: 'member',
  });
  users[who] = { id: user.id, token };
  return user.id;
}

interface CharSeed {
  userId: number;
  name: string;
  race: string;
  level: number | null;
  guildId?: number;
  gameId?: number;
}

/** A character; with `guildId`, also its latest-snapshot roster row (claimed). */
async function seedChar(c: CharSeed): Promise<string> {
  const guid = `Player-7-dp-${c.name}`;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: c.userId,
        gameId: c.gameId ?? foreverGame,
        name: c.name,
        class: 'Warrior',
        race: c.race,
        level: c.level,
        region: 'us',
        addonGuid: guid,
      })
      .returning(),
    c.name,
  );
  if (c.guildId !== undefined)
    await rosterRow(c.guildId, guid, c.name, c.level);
  return char.id;
}

async function rosterRow(
  guildId: number,
  guid: string,
  name: string,
  level: number | null,
): Promise<void> {
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: name,
    level,
    class: 'Warrior',
    rankIndex: 3,
    rankName: 'Rank 3',
    source: 'addon_import',
    lastSeenAt: SNAP,
  });
}

async function seedQuests(): Promise<void> {
  const dungeonInstanceId = defined(
    resolveQuestInstanceIds(DUNGEON.id)[0],
    'quest instance id',
  );
  const base = { expansion: 'classic', questLevel: 20, dungeonInstanceId };
  await testApp.db.insert(schema.wowClassicDungeonQuests).values([
    { ...base, questId: Q.horde1, name: 'Horde one', raceRestriction: ['Orc'] },
    {
      ...base,
      questId: Q.horde2,
      name: 'Horde two',
      raceRestriction: ['Troll', 'Undead'],
    },
    {
      ...base,
      questId: Q.alliance,
      name: 'Alliance only',
      raceRestriction: ['Human'],
    },
    { ...base, questId: Q.neutralNull, name: 'Neutral', raceRestriction: null },
    {
      ...base,
      questId: Q.neutralEmpty,
      name: 'Neutral two',
      raceRestriction: [],
    },
  ]);
}

/** lead owns four claimed Alliance characters spanning the level range. */
async function seedAllianceRoster(): Promise<void> {
  const lead = await seedUser('lead');
  const g = guilds.alliance;
  const min = DUNGEON.minimumLevel;
  const max = DUNGEON.maximumLevel;
  const own = { userId: lead, race: 'Human', guildId: g };
  chars.below = await seedChar({ ...own, name: 'Belowa', level: min - 1 });
  chars.inRange = await seedChar({ ...own, name: 'Inrangea', level: min });
  chars.above = await seedChar({ ...own, name: 'Abovea', level: max + 1 });
  chars.noLevel = await seedChar({ ...own, name: 'Nolevela', level: null });
  // A Horde-race alt on the Alliance roster: with a Human it makes the
  // characters' side mixed, so the readiness builder's own side filter is off
  // and only the guild pre-filter can hide quests (I6).
  chars.orcAlt = await seedChar({
    ...own,
    race: 'Orc',
    name: 'Orcalta',
    level: 30,
  });
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId: chars.below,
    section: 'char',
    schema: 2,
    // A contract-valid `char` payload (the facts sources read gear/lockouts).
    data: AddonCharSnapshotDataSchema.parse({
      gear: [],
      talents: { nodes: [] },
      lockouts: [],
      quests: {
        completed: [Q.neutralNull],
        inProgress: [{ questId: Q.neutralEmpty }],
      },
    }),
    capturedAt: SNAP,
    payloadSha256: 'e'.repeat(64),
  });
  // Unclaimed roster row; its would-be character lives on another game.
  await rosterRow(g, 'Player-7-dp-Wouldbe', 'Wouldbe', 30);
  chars.wouldBe = await seedChar({
    userId: await seedUser('outsider'),
    name: 'Wouldbe',
    race: 'Orc',
    level: 30,
    gameId: classicGame,
  });
}

async function seedOtherHubs(): Promise<void> {
  chars.other = await seedChar({
    userId: await seedUser('otherOwner'),
    name: 'Otherguilda',
    race: 'Orc',
    level: 30,
    guildId: guilds.other,
  });
  for (const [who, race] of [
    ['hordeA', 'Orc'],
    ['hordeB', 'Troll'],
  ] as const) {
    hordeChars.push(
      await seedChar({
        userId: await seedUser(who),
        name: `${who}char`,
        race,
        level: 30,
        guildId: guilds.neutral,
      }),
    );
  }
}

/** A Forever event on the dungeon with `charId` signed up (I8 parity). */
async function seedParityEvent(userId: number, charId: string) {
  const start = new Date(Date.now() + 24 * HOUR);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Plan parity',
        creatorId: testApp.seed.adminUser.id,
        duration: [start, new Date(start.getTime() + HOUR)],
        gameId: foreverGame,
        guildId: guilds.alliance,
        contentInstances: [{ id: DUNGEON.id, name: DUNGEON.name }],
      })
      .returning(),
    'event',
  );
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId: event.id, userId, characterId: charId });
  return event.id;
}

function planUrl(
  gid: number,
  ids: readonly string[] = [],
  instanceId: number | string = DUNGEON.id,
): string {
  const q = `instanceId=${instanceId}`;
  const c = ids.length > 0 ? `&characterIds=${ids.join(',')}` : '';
  return `/plugins/wow/guilds/${gid}/dungeon-plan?${q}${c}`;
}

const get = (url: string, token: string) =>
  testApp.request.get(url).set('Authorization', `Bearer ${token}`);

async function plan(
  gid: number,
  ids: readonly string[] = [],
  token = adminToken,
): Promise<DungeonPlanDto> {
  const res = await get(planUrl(gid, ids), token);
  expect(res.status).toBe(200);
  const parsed = DungeonPlanSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
  return res.body as DungeonPlanDto;
}

const questIds = (p: DungeonPlanDto) =>
  p.readiness.quests.map((q) => q.questId).sort((a, b) => a - b);

beforeAll(async () => {
  testApp = await getTestApp();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  clearKnownQuestMemo();
  foreverGame = await ensureGame(FOREVER_SLUG);
  classicGame = await ensureGame(CLASSIC_SLUG);
  await seedQuests();
  guilds.alliance = await insertGuild('Plan Alliance', { faction: 'ALLIANCE' });
  guilds.horde = await insertGuild('Plan Horde', { faction: 'Horde' });
  guilds.neutral = await insertGuild('Plan Sideless');
  guilds.empty = await insertGuild('Plan Empty');
  guilds.other = await insertGuild('Plan Other', { faction: 'Horde' });
  guilds.hidden = await insertGuild('Plan Hidden', { hiddenAt: new Date() });
  await seedAllianceRoster();
  await seedOtherHubs();
  fetchSpy = jest.spyOn(globalThis, 'fetch');
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.
afterAll(() => {
  fetchSpy.mockRestore();
  clearKnownQuestMemo();
});

describe('dungeon-plan — access (I1–I3)', () => {
  it('I1: 200 + contract parse for a member, staff and a signed-in visitor', async () => {
    await plan(guilds.alliance, [chars.inRange], users.lead.token);
    await plan(guilds.alliance, [chars.inRange], adminToken);
    await plan(guilds.alliance, [chars.inRange], users.outsider.token);
  });

  it('I2: a hidden hub is 404 for a non-staff non-member; staff get 200', async () => {
    const res = await get(planUrl(guilds.hidden), users.outsider.token);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('readiness');
    await plan(guilds.hidden, [], adminToken);
  });

  it('I3: a Classic wow_guild and a Forever community hub are 404', async () => {
    const classic = await insertGuild('Plan Classic', { gameId: classicGame });
    const community = await insertGuild('Plan Community', {
      kind: 'game_community',
    });
    for (const gid of [classic, community]) {
      const res = await get(planUrl(gid), adminToken);
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('readiness');
    }
  });
});

describe('dungeon-plan — validation (I4)', () => {
  it('400 for a raid, an unlisted parent and an unknown instance', async () => {
    for (const id of [RAID.id, 316, 987654321]) {
      const res = await get(planUrl(guilds.alliance, [], id), adminToken);
      expect({ id, status: res.status }).toEqual({ id, status: 400 });
    }
  });

  it('400 for six ids or a non-uuid id', async () => {
    const six = Array.from({ length: 6 }, () => chars.inRange);
    expect((await get(planUrl(guilds.alliance, six), adminToken)).status).toBe(
      400,
    );
    const bad = await get(planUrl(guilds.alliance, ['not-a-uuid']), adminToken);
    expect(bad.status).toBe(400);
  });
});

describe('dungeon-plan — roster-only characters (I5)', () => {
  it('keeps the claimed roster character; drops another guild and an unclaimed row', async () => {
    const res = await get(
      planUrl(guilds.alliance, [chars.inRange, chars.other, chars.wouldBe]),
      adminToken,
    );
    expect(res.status).toBe(200);
    const body = res.body as DungeonPlanDto;
    expect(body.characters.map((c) => c.characterId)).toEqual([chars.inRange]);
    expect(body.droppedCharacterIds).toEqual([chars.other, chars.wouldBe]);
    expect(body.readiness.signups.map((s) => s.characterId)).toEqual([
      chars.inRange,
    ]);
    const raw =
      JSON.stringify(body.characters) + JSON.stringify(body.readiness);
    expect(raw).not.toContain('Otherguilda');
    expect(raw).not.toContain('Wouldbe');
    // The guild side wins: dropping Horde characters leaves it 'guild'.
    expect(body.sideSource).toBe('guild');
  });
});

describe('dungeon-plan — faction filter (I6, I7, I10)', () => {
  it('I6: an ALLIANCE guild hides both Horde-only quests and keeps the neutral ones', async () => {
    const body = await plan(guilds.alliance, [chars.inRange, chars.orcAlt]);
    expect(body.characters).toHaveLength(2);
    expect(questIds(body)).toEqual(
      [Q.alliance, ...NEUTRAL].sort((a, b) => a - b),
    );
    expect(body.hiddenOtherFaction).toBe(2);
    expect(body.side).toBe('alliance');
    expect(body.sideSource).toBe('guild');
  });

  it("I6 mirror: a 'Horde' guild hides the Alliance-only quest", async () => {
    const body = await plan(guilds.horde);
    expect(questIds(body)).toEqual(
      [Q.horde1, Q.horde2, ...NEUTRAL].sort((a, b) => a - b),
    );
    expect(body.hiddenOtherFaction).toBe(1);
    expect(body.side).toBe('horde');
    expect(body.sideSource).toBe('guild');
  });

  it('I7: no guild faction + two Horde characters → characters side', async () => {
    const body = await plan(guilds.neutral, hordeChars);
    expect(body.side).toBe('horde');
    expect(body.sideSource).toBe('characters');
    expect(questIds(body)).not.toContain(Q.alliance);
    expect(body.hiddenOtherFaction).toBe(1);
  });

  it('I7/I10: no guild faction and no characters → nothing hidden, empty signups', async () => {
    const body = await plan(guilds.empty);
    expect(body.side).toBeNull();
    expect(body.sideSource).toBeNull();
    expect(body.hiddenOtherFaction).toBe(0);
    expect(questIds(body)).toEqual(ALL_QUESTS);
    expect(body.characters).toEqual([]);
    expect(body.readiness.signups).toEqual([]);
  });

  it('I10: no characterIds on a sided guild → the filtered quests, no signups', async () => {
    const body = await plan(guilds.alliance);
    expect(body.characters).toEqual([]);
    expect(body.droppedCharacterIds).toEqual([]);
    expect(body.readiness.signups).toEqual([]);
    expect(questIds(body)).toEqual(
      [Q.alliance, ...NEUTRAL].sort((a, b) => a - b),
    );
  });
});

describe('dungeon-plan — readiness parity (I8)', () => {
  it("equals the event readiness endpoint's cells for the same character", async () => {
    const eventId = await seedParityEvent(users.lead.id, chars.below);
    const body = await plan(guilds.alliance, [chars.below], users.lead.token);
    const res = await get(
      `/plugins/wow-classic/events/${eventId}/quest-readiness`,
      users.lead.token,
    );
    expect(res.status).toBe(200);
    const eventRow = (
      res.body as { signups: DungeonPlanDto['readiness']['signups'] }
    ).signups.find((s) => s.characterId === chars.below);
    const planRow = body.readiness.signups.find(
      (s) => s.characterId === chars.below,
    );
    expect(planRow?.perQuest.length).toBe(body.readiness.quests.length);
    for (const q of body.readiness.quests) {
      const mine = planRow?.perQuest.find((p) => p.questId === q.questId);
      const theirs = eventRow?.perQuest.find((p) => p.questId === q.questId);
      expect({ questId: q.questId, cell: mine }).toEqual({
        questId: q.questId,
        cell: theirs,
      });
    }
    expect(
      planRow?.perQuest.find((p) => p.questId === Q.neutralNull)?.state,
    ).toBe('done');
    expect(
      planRow?.perQuest.find((p) => p.questId === Q.neutralEmpty)?.state,
    ).toBe('have');
  });

  it('a claimed character with no quest data is unknown on every quest', async () => {
    const body = await plan(guilds.alliance, [chars.inRange]);
    const row = defined(body.readiness.signups[0], 'signup');
    expect(row.perQuest.map((p) => p.state)).toEqual(
      body.readiness.quests.map(() => 'unknown'),
    );
  });
});

describe('dungeon-plan — level fit (I9)', () => {
  it('below / in / above / unknown against the catalogue range', async () => {
    const range = getInstance(DUNGEON.id, 'wow_forever');
    if (range === null) throw new Error('catalogue range missing');
    const ids = [chars.below, chars.inRange, chars.above, chars.noLevel];
    const body = await plan(guilds.alliance, ids);
    expect(body.instance).toEqual({
      id: range.id,
      name: range.name,
      minimumLevel: range.minimumLevel,
      maximumLevel: range.maximumLevel,
    });
    expect(
      body.characters.map((c) => [c.characterId, c.level, c.levelFit]),
    ).toEqual([
      [chars.below, range.minimumLevel - 1, 'below'],
      [chars.inRange, range.minimumLevel, 'in'],
      [chars.above, range.maximumLevel + 1, 'above'],
      [chars.noLevel, null, 'unknown'],
    ]);
  });
});

describe('dungeon-plan — no outbound network (I11)', () => {
  it('makes zero fetch calls while planning with characters and without', async () => {
    fetchSpy.mockClear();
    await plan(guilds.alliance, [chars.below, chars.inRange, chars.noLevel]);
    await plan(guilds.neutral, hordeChars);
    await plan(guilds.empty);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
