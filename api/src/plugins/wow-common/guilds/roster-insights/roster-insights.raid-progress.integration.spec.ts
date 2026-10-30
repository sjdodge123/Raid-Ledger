/**
 * ROK-1917 (W10 "Raid progress") — `GET /plugins/wow/guilds/:id/roster-insights`
 * `raidProgress` against a real DB. Its own guild and users (split from
 * `roster-insights.integration.spec.ts`, which is near the 750-line limit).
 *
 * AC1: only pulls of this hub's game + region + guild key count, and only when
 * a linked roster user (or a since-deleted user) reported them (Q1).
 * AC3: two stored pulls 1 s apart count once; 11 s apart count twice.
 * AC4: members get the key; a visitor's payload has NO `raidProgress` key.
 * Staff who are not members get the member payload, `raidProgress` included
 * (as ROK-1915's `gear`); a community (non-`wow_guild`) hub has no key even
 * when pulls match its game, region and name key.
 * Codex P2: a re-import by a roster member claims a duplicate pull whose
 * reporter is off the roster; an outsider's re-import never moves a pull.
 */
import { and, eq } from 'drizzle-orm';
import {
  WowRosterInsightsSchema,
  type AddonPull,
  type AddonRaidExport,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { loginAsAdmin } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import * as schema from '../../../../drizzle/schema';
import { insertCommunityHub } from '../../../../guilds/community/community-proposals.queries';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { applyRaid } from '../../addon-import/addon-import-raid.apply';
import { buildRaidPayload } from '../../addon-import/testing/addon-fixture.builder';
import { RosterInsightsCache } from './roster-insights.cache';

const GUILD_NAME = 'Raid Progress 1917';
const GUILD_KEY = GUILD_NAME.toLowerCase();
const T0 = Date.parse('2026-10-22T20:00:00.000Z');
const at = (s: number): Date => new Date(T0 + s * 1000);

type Who = 'raider' | 'officer' | 'pug' | 'visitor';

let testApp: TestApp;
let guildId: number;
let communityHubId: number;
let otherGameId: number;
const userIds = new Map<Who, number>();
const tokens = new Map<Who | 'staff', string>();

function idOf(who: Who): number {
  const id = userIds.get(who);
  if (id === undefined) throw new Error(`no user ${who}`);
  return id;
}

/** A user; `raider` and `officer` also get a linked character on the guild roster. */
async function seedUser(who: Who): Promise<void> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username: `rp1917-${who}`,
        discordId: `local:rp1917-${who}@test`,
        role: 'member',
      })
      .returning(),
    `user ${who}`,
  );
  userIds.set(who, user.id);
  tokens.set(
    who,
    await signTestAccessToken(testApp, {
      sub: user.id,
      username: user.username,
    }),
  );
  if (who === 'raider' || who === 'officer') await seedRosterChar(user.id, who);
}

async function seedRosterChar(userId: number, who: Who): Promise<void> {
  const guid = `Player-7-rp1917${who}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: 'Raidwren',
    class: 'Warrior',
    level: 60,
    addonGuid: guid,
    gameVariant: 'wow_forever',
    ruleset: 'normal',
    isMain: true,
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: 'Raidwren',
    level: 60,
    class: 'Warrior',
    rankIndex: 2,
    rankName: 'Raider',
    source: 'addon_import',
    lastSeenAt: at(0),
  });
}

interface PullSpec {
  encounterId: number;
  start: number;
  success: boolean;
  reporter: Who | null;
  gameId?: number;
  region?: string;
  guildKey?: string;
}

function pullRow(p: PullSpec): typeof schema.addonEncounterPulls.$inferInsert {
  return {
    gameId: p.gameId ?? testApp.seed.game.id,
    region: p.region ?? 'us',
    encounterId: p.encounterId,
    encounterName: `Boss ${p.encounterId}`,
    difficultyId: 9,
    groupSize: 40,
    startAt: at(p.start),
    endAt: at(p.start + 60),
    success: p.success,
    roster: [{ guid: 'Player-7-rp1917raider', name: 'Raidwren' }],
    guildKey: p.guildKey ?? GUILD_KEY,
    reportedByUserId: p.reporter === null ? null : idOf(p.reporter),
    payloadSha256: 'b'.repeat(64),
  };
}

/** In scope: 663 kill+wipe, 664 two wipes 1 s apart (one by a deleted user), 665 two wipes 11 s apart. */
const IN_SCOPE: PullSpec[] = [
  { encounterId: 663, start: 0, success: false, reporter: 'raider' },
  { encounterId: 663, start: 600, success: true, reporter: 'raider' },
  { encounterId: 664, start: 1200, success: false, reporter: 'raider' },
  { encounterId: 664, start: 1201, success: false, reporter: null },
  { encounterId: 665, start: 1800, success: false, reporter: 'raider' },
  { encounterId: 665, start: 1811, success: false, reporter: 'raider' },
];

/** Out of scope (AC1 / Q1): each would add its own boss row if it counted. */
function outOfScope(): PullSpec[] {
  const base = { start: 3000, success: true, reporter: 'raider' as const };
  return [
    { ...base, encounterId: 700, guildKey: 'another guild' },
    { ...base, encounterId: 701, region: 'eu' },
    { ...base, encounterId: 702, guildKey: '' },
    { ...base, encounterId: 703, gameId: otherGameId },
    { ...base, encounterId: 704, reporter: 'pug' },
  ];
}

async function insertGuild(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name: GUILD_NAME,
        nameKey: GUILD_KEY,
        source: 'addon_import',
        lastSnapshotAt: at(0),
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function insertOtherGame(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'RP1917 Other Game', slug: 'rp1917-other-game' })
      .returning(),
    'other game',
  );
  return g.id;
}

/**
 * A Forever-style community hub on the same game, plus a trusted pull whose
 * game, region and guild key match it — it would count if the hub kind were
 * not checked.
 */
async function seedCommunityHub(): Promise<void> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name: 'RP1917 Community',
    blurb: 'ROK-1917 hub',
    status: 'active',
    proposedBy: idOf('raider'),
    reviewedBy: null,
  });
  communityHubId = hub.id;
  await testApp.db.insert(schema.addonEncounterPulls).values(
    pullRow({
      encounterId: 800,
      start: 0,
      success: true,
      reporter: null,
      region: hub.region,
      guildKey: hub.nameKey,
    }),
  );
  testApp.app.get(RosterInsightsCache).invalidateGuild(communityHubId);
}

const insights = (who: Who | 'staff', gid = guildId) =>
  testApp.request
    .get(`/plugins/wow/guilds/${gid}/roster-insights`)
    .set('Authorization', `Bearer ${tokens.get(who) ?? ''}`);

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild();
  otherGameId = await insertOtherGame();
  for (const who of ['raider', 'officer', 'pug', 'visitor'] as const)
    await seedUser(who);
  await testApp.db
    .insert(schema.addonEncounterPulls)
    .values([...IN_SCOPE, ...outOfScope()].map(pullRow));
  testApp.app.get(RosterInsightsCache).invalidateGuild(guildId);
  await seedCommunityHub();
  tokens.set('staff', await loginAsAdmin(testApp.request, testApp.seed));
});

describe('roster-insights raidProgress (ROK-1917, real DB)', () => {
  it('AC1/AC2/AC3: a member gets per-boss kills and wipes from in-scope pulls only', async () => {
    const res = await insights('raider');
    expect(res.status).toBe(200);
    const rp = WowRosterInsightsSchema.parse(res.body).raidProgress;
    if (!rp) throw new Error('member payload has no raidProgress key');
    expect(
      rp.bosses.map((b) => [b.encounterId, b.kills, b.wipes, b.firstKillAt]),
    ).toEqual([
      [663, 1, 1, at(660).toISOString()],
      [665, 0, 2, null],
      [664, 0, 1, null],
    ]);
    expect(rp).toMatchObject({
      killedCount: 1,
      pullCount: 5,
      lastPullAt: at(1871).toISOString(),
    });
  });

  it('AC4: a visitor payload has NO raidProgress key', async () => {
    const res = await insights('visitor');
    expect(res.status).toBe(200);
    WowRosterInsightsSchema.parse(res.body);
    expect('raidProgress' in res.body).toBe(false);
  });

  it('D6: the payload never carries a pull roster or player name', async () => {
    const res = await insights('raider');
    expect(res.body.raidProgress).toBeDefined();
    expect(JSON.stringify(res.body.raidProgress)).not.toMatch(
      /Raidwren|Player-7|roster/,
    );
  });

  it('staff who are not members get raidProgress, same as a member (as ROK-1915 gear)', async () => {
    const staff = await insights('staff');
    expect(staff.status).toBe(200);
    const dto = WowRosterInsightsSchema.parse(staff.body);
    const rp = dto.raidProgress;
    if (!rp) throw new Error('staff payload has no raidProgress key');
    expect(Object.keys(dto)).toContain('gear');
    const member = WowRosterInsightsSchema.parse(
      (await insights('raider')).body,
    );
    expect(rp).toEqual(member.raidProgress);
  });

  it('a community (non-wow_guild) hub has NO raidProgress key, even for staff', async () => {
    const res = await insights('staff', communityHubId);
    expect(res.status).toBe(200);
    const dto = WowRosterInsightsSchema.parse(res.body);
    expect(Object.keys(dto)).toContain('gear');
    expect('raidProgress' in res.body).toBe(false);
  });
});

/** A payload for this guild re-reporting `start`-second pulls of `encounterId`. */
function reimportPayload(encounterId: number, start: number): AddonRaidExport {
  const base = buildRaidPayload();
  const pull: AddonPull = {
    encounterId,
    name: `Boss ${encounterId}`,
    difficultyId: 9,
    groupSize: 40,
    startAt: T0 / 1000 + start,
    endAt: T0 / 1000 + start + 60,
    success: false,
    roster: [],
    rosterNames: [],
  };
  return {
    ...base,
    who: { ...base.who, guildName: GUILD_NAME },
    data: { pulls: [pull] },
  };
}

/** Run the real raid apply as `who`, with a character they own. */
let reimportSeq = 0;

async function reimportAs(who: Who, payload: AddonRaidExport) {
  const userId = idOf(who);
  reimportSeq += 1;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId: testApp.seed.game.id,
        name: `Re${who}${reimportSeq}`,
      })
      .returning({ id: schema.characters.id }),
    `${who} character`,
  );
  const ctx = {
    tx: testApp.db,
    userId,
    characterId: char.id,
    gameId: testApp.seed.game.id,
    region: 'us' as const,
    sha256: 'c'.repeat(64),
  };
  const out = await applyRaid(ctx, payload);
  testApp.app.get(RosterInsightsCache).invalidateGuild(guildId);
  return out;
}

async function reporterOf(encounterId: number): Promise<number | null> {
  const p = schema.addonEncounterPulls;
  const [row] = nonEmpty(
    await testApp.db
      .select({ by: p.reportedByUserId })
      .from(p)
      .where(and(eq(p.encounterId, encounterId), eq(p.guildKey, GUILD_KEY))),
    `pull ${encounterId}`,
  );
  return row.by;
}

/** Raid progress as the raider sees it: `[encounterId, kills, wipes]` per boss. */
async function bossRows(): Promise<Array<[number, number, number]>> {
  const res = await insights('raider');
  const rp = WowRosterInsightsSchema.parse(res.body).raidProgress;
  return (rp?.bosses ?? []).map((b) => [b.encounterId, b.kills, b.wipes]);
}

/** Seed a stored pull of `encounterId` at `start`, reported by `reporter`. */
async function seedStored(
  encounterId: number,
  start: number,
  success: boolean,
  reporter: Who | null,
): Promise<void> {
  await testApp.db
    .insert(schema.addonEncounterPulls)
    .values(pullRow({ encounterId, start, success, reporter }));
  testApp.app.get(RosterInsightsCache).invalidateGuild(guildId);
}

async function bossIds(): Promise<number[]> {
  const res = await insights('raider');
  const rp = WowRosterInsightsSchema.parse(res.body).raidProgress;
  return (rp?.bosses ?? []).map((b) => b.encounterId);
}

describe('raid import reporter hand-over (ROK-1917 Codex P2, real DB)', () => {
  it('a roster member re-importing a pull whose reporter left the roster makes it count', async () => {
    // `pug` stands in for a first reporter no longer on the linked roster.
    await testApp.db.insert(schema.addonEncounterPulls).values(
      pullRow({
        encounterId: 900,
        start: 4000,
        success: false,
        reporter: 'pug',
      }),
    );
    testApp.app.get(RosterInsightsCache).invalidateGuild(guildId);
    expect(await bossIds()).not.toContain(900);
    const out = await reimportAs('raider', reimportPayload(900, 4000));
    expect(out.summary).toMatchObject({ newPulls: 0, duplicatePulls: 1 });
    expect(await reporterOf(900)).toBe(idOf('raider'));
    expect(await bossIds()).toContain(900);
  });

  it('an outsider re-importing a trusted pull does NOT move its reporter', async () => {
    await testApp.db.insert(schema.addonEncounterPulls).values(
      pullRow({
        encounterId: 901,
        start: 4100,
        success: false,
        reporter: 'raider',
      }),
    );
    const out = await reimportAs('pug', reimportPayload(901, 4100));
    expect(out.summary).toMatchObject({ newPulls: 0, duplicatePulls: 1 });
    expect(await reporterOf(901)).toBe(idOf('raider'));
    expect(await bossIds()).toContain(901);
  });
  it('a hand-over replaces the content too: an outsider-forged kill stops counting', async () => {
    await seedStored(902, 4200, true, 'pug');
    const out = await reimportAs('raider', reimportPayload(902, 4200));
    expect(out.summary).toMatchObject({ newPulls: 0, duplicatePulls: 1 });
    expect(await reporterOf(902)).toBe(idOf('raider'));
    const boss = (await bossRows()).find(([id]) => id === 902);
    expect(boss).toEqual([902, 0, 1]);
  });

  it('a since-deleted (NULL) reporter keeps its pull and content', async () => {
    await seedStored(903, 4300, true, null);
    const out = await reimportAs('raider', reimportPayload(903, 4300));
    expect(out.summary).toMatchObject({ newPulls: 0, duplicatePulls: 1 });
    expect(await reporterOf(903)).toBeNull();
    expect((await bossRows()).find(([id]) => id === 903)).toEqual([903, 1, 0]);
  });

  it('a member never takes a pull reported by another roster member', async () => {
    await seedStored(904, 4400, true, 'officer');
    const out = await reimportAs('raider', reimportPayload(904, 4400));
    expect(out.summary).toMatchObject({ newPulls: 0, duplicatePulls: 1 });
    expect(await reporterOf(904)).toBe(idOf('officer'));
    expect((await bossRows()).find(([id]) => id === 904)).toEqual([904, 1, 0]);
  });

  it('a takeover import still counts its genuinely new pulls as new (xmax = 0)', async () => {
    await seedStored(905, 4500, true, 'pug');
    const base = reimportPayload(905, 4500);
    const fresh = reimportPayload(906, 4600).data.pulls;
    const payload = {
      ...base,
      data: { pulls: [...base.data.pulls, ...fresh] },
    };
    const out = await reimportAs('raider', payload);
    expect(out.summary).toMatchObject({ newPulls: 1, duplicatePulls: 1 });
    expect(await reporterOf(905)).toBe(idOf('raider'));
    expect(await reporterOf(906)).toBe(idOf('raider'));
  });

  it('a first-ever import whose pinned GUID is on the roster takes over an off-roster pull', async () => {
    // ROK-1917 final P2: the binding (GUID pin) is written AFTER the raid
    // section runs; the pending GUID must already make the importer trusted.
    await seedStored(907, 4700, false, 'pug');
    const ctx = await seedFirstImporter('rp1917-first', 'Firstwren', null);
    const out = await applyRaid(ctx, reimportPayload(907, 4700));
    expect(out.summary).toMatchObject({ newPulls: 0, duplicatePulls: 1 });
    expect(await reporterOf(907)).toBe(ctx.userId);
  });

  it('a deactivated first-time importer is NOT trusted by its pending GUID', async () => {
    // ROK-1917 round-4: same active-owner predicate as the roster's link (D3).
    await seedStored(908, 4800, false, 'pug');
    const ctx = await seedFirstImporter('rp1917-gone', 'Gonewren', at(-60));
    const out = await applyRaid(ctx, reimportPayload(908, 4800));
    expect(out.summary).toMatchObject({ newPulls: 0, duplicatePulls: 1 });
    expect(await reporterOf(908)).toBe(idOf('pug'));
  });
});

/**
 * A user whose character sits on the roster by GUID but has no `addonGuid`
 * pinned yet (a first import), as an apply context carrying that pending GUID.
 */
async function seedFirstImporter(
  username: string,
  name: string,
  deactivatedAt: Date | null,
): Promise<Parameters<typeof applyRaid>[0]> {
  const guid = `Player-7-${username}`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username,
        discordId: `local:${username}@test`,
        role: 'member',
        deactivatedAt,
      })
      .returning({ id: schema.users.id }),
    `${username} user`,
  );
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: name,
    level: 60,
    class: 'Mage',
    rankIndex: 3,
    rankName: 'Raider',
    source: 'addon_import',
    lastSeenAt: at(0),
  });
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({ userId: user.id, gameId: testApp.seed.game.id, name })
      .returning({ id: schema.characters.id }),
    `${username} character (addonGuid not pinned yet)`,
  );
  return {
    tx: testApp.db,
    userId: user.id,
    characterId: char.id,
    gameId: testApp.seed.game.id,
    region: 'us' as const,
    sha256: 'd'.repeat(64),
    pendingGuid: guid,
  };
}
