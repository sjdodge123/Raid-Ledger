/**
 * ROK-1913 (H5) — `GET /plugins/wow/guilds/:id/roster-insights` against a
 * real DB: a Forever guild (roster rows + 3 linked characters + 1 LedgerLink
 * snapshot). Asserts the contract parse, the visitor/member professions
 * and lockouts (ROK-1914) split, import invalidation of the 5-min cache (incl. a real first-time
 * create import), the hidden-hub 404, and a 2000-row timing guard with 300
 * linked + snapshotted rows so the character/snapshot fact queries run.
 */
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { WowRosterInsightsSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { RosterInsightsCache } from './roster-insights.cache';
import { RosterInsightsService } from './roster-insights.service';
import {
  FIXTURE_GUID,
  buildCharPayload,
  buildImportString,
} from '../../addon-import/testing/addon-fixture.builder';
import { pinExportClock } from '../../addon-import/testing/pin-export-clock';

pinExportClock();

const SNAP = new Date('2026-11-04T20:00:00.000Z');
const PROFESSIONS = {
  primary: [
    {
      id: 171,
      name: 'Alchemy',
      slug: 'alchemy',
      skillLevel: 300,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: SNAP.toISOString(),
};
type Who = 'lead' | 'healer' | 'crafter' | 'outsider';

let testApp: TestApp;
let guildId: number;
const tokens = {} as Record<Who, string>;
const charIds = {} as Record<Who, string>;

const FOREVER_SLUG = 'world-of-warcraft-forever';
/** ROK-1914 — real-clock lockouts (the service reads `Date.now()`). */
const LIVE_RESET_S = Math.floor(Date.now() / 1000) + 7 * 86400;
const LIVE_LOCKOUT = {
  name: 'Molten Core',
  instanceId: 409,
  difficultyId: 9,
  resetAt: LIVE_RESET_S,
  killed: 4,
  total: 10,
};
const EXPIRED_LOCKOUT = {
  ...LIVE_LOCKOUT,
  name: 'Onyxia',
  instanceId: 249,
  resetAt: Math.floor(Date.now() / 1000) - 3600,
};

/** The Forever game the create-import route resolves (`foreverGameId`). */
async function ensureForeverGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning(),
    'game',
  );
  return game.id;
}

async function insertGuild(
  name: string,
  gameId: number = testApp.seed.game.id,
): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

function memberRow(
  gid: number,
  guid: string,
  name: string,
  level: number,
  cls: string,
) {
  return {
    guildId: gid,
    guid,
    characterName: name,
    level,
    class: cls,
    rankIndex: 2,
    rankName: 'Raider',
    source: 'addon_import',
    lastSeenAt: SNAP,
  };
}

/** A local-login user + Forever character; members also get a roster row. */
async function seedUser(
  who: Who,
  level: number,
  cls: string,
  extra: Partial<typeof schema.characters.$inferInsert>,
): Promise<void> {
  const email = `${who}@insights.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: who, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const guid = `Player-7-${who}`;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: who,
        class: cls,
        level,
        addonGuid: guid,
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        isMain: true,
        ...extra,
      })
      .returning(),
    'character',
  );
  charIds[who] = char.id;
  if (who !== 'outsider')
    await testApp.db
      .insert(schema.guildMembers)
      .values(memberRow(guildId, guid, who, level, cls));
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
}

/**
 * ROK-1916 — export presence: lead online, healer online WITH a day count
 * (D3: still online), crafter never reported, two pugs away 40 and 2 days.
 */
async function seedPresence(): Promise<void> {
  const presence: [string, boolean | null, number | null][] = [
    ['lead', true, null],
    ['healer', true, 3],
    ['Pugone', false, 40],
    ['Pugtwo', false, 2],
  ];
  for (const [name, onlineAtExport, lastOnlineDays] of presence)
    await testApp.db
      .update(schema.guildMembers)
      .set({ onlineAtExport, lastOnlineDays })
      .where(
        and(
          eq(schema.guildMembers.guildId, guildId),
          eq(schema.guildMembers.characterName, name),
        ),
      );
}

/**
 * ROK-1916 (D4) — a second guild where lead's MAIN was away 5 days and lead's
 * ALT was online. `mainsOnly` drops the alt from the breakdowns, but presence
 * is per character, so `lastSeen` must still count it.
 */
async function seedAltPresenceGuild(): Promise<{ gid: number; altId: string }> {
  const gid = await insertGuild('Forever Alt Presence');
  const [main] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, charIds.lead)),
    'lead main',
  );
  const [alt] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: main.userId,
        gameId: testApp.seed.game.id,
        name: 'Leadalt',
        class: 'Rogue',
        level: 30,
        addonGuid: 'Player-7-leadalt',
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        isMain: false,
      })
      .returning(),
    'lead alt',
  );
  await testApp.db.insert(schema.guildMembers).values([
    {
      ...memberRow(gid, 'Player-7-lead', 'lead', 60, 'Warrior'),
      onlineAtExport: false,
      lastOnlineDays: 5,
    },
    {
      ...memberRow(gid, 'Player-7-leadalt', 'Leadalt', 30, 'Rogue'),
      onlineAtExport: true,
    },
  ]);
  return { gid, altId: alt.id };
}

const insights = (who: Who, gid = guildId) =>
  testApp.request
    .get(`/plugins/wow/guilds/${gid}/roster-insights`)
    .set('Authorization', `Bearer ${tokens[who]}`);

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Forever Insights');
  await seedUser('lead', 60, 'Warrior', { roleOverride: 'tank' });
  await seedUser('healer', 45, 'Priest', { role: 'healer' });
  await seedUser('crafter', 22, 'Mage', { professions: PROFESSIONS });
  await seedUser('outsider', 60, 'Rogue', {});
  await testApp.db.insert(schema.guildMembers).values([
    memberRow(guildId, 'Player-7-pug1', 'Pugone', 8, 'Mage'),
    memberRow(guildId, 'Player-7-pug2', 'Pugtwo', 60, 'Hunter'),
    // ROK-1916 — left the guild before the latest snapshot: never shown.
    {
      ...memberRow(guildId, 'Player-7-gone', 'Gone', 60, 'Rogue'),
      lastSeenAt: new Date(SNAP.getTime() - 86400_000),
      onlineAtExport: true,
    },
  ]);
  await seedPresence();
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId: charIds.lead,
    section: 'char',
    schema: 2,
    data: {
      // ROK-1915: wrist (9) equipped without an enchant, chest (5) enchanted.
      gear: [
        { slot: 1, itemId: 16866, ilvl: 66, bonusIds: [] },
        { slot: 9, itemId: 16861, ilvl: 66, bonusIds: [] },
        { slot: 5, itemId: 16865, ilvl: 66, bonusIds: [], enchantId: 1891 },
      ],
      talents: { nodes: [] },
      lockouts: [LIVE_LOCKOUT, EXPIRED_LOCKOUT],
    },
    capturedAt: SNAP,
    payloadSha256: 'a'.repeat(64),
  });
});

describe('GET roster-insights (real DB)', () => {
  it('a member gets a contract-valid payload WITH professions', async () => {
    const res = await insights('healer');
    expect(res.status).toBe(200);
    const dto = WowRosterInsightsSchema.parse(res.body);
    expect(dto.classes.find((c) => c.class === 'Mage')?.count).toBe(2);
    expect(dto.levels).toMatchObject({ max: 60, atCap: 2 });
    expect(dto.roles.raid).toEqual({ tank: 1, healer: 0, dps: 0, unknown: 0 });
    expect(dto.roles.dungeon).toMatchObject({ tank: 1, healer: 1 });
    expect(dto.professions).toEqual([
      {
        name: 'Alchemy',
        members: [
          expect.objectContaining({ characterId: charIds.crafter, skill: 300 }),
        ],
      },
    ]);
    // 3 linked members: lead (LedgerLink gear snapshot) and healer (its
    // `role` column lives on an addonGuid row, so `rowOrigin` labels it
    // addon) are addon-fed; crafter's level/class lose to the newer roster
    // facts and its professions are manual, so it has no addon/blizzard fact.
    expect(dto.freshness.characters).toEqual({
      addon: 2,
      blizzard: 0,
      none: 1,
    });
  });

  it('a member gets live lockouts grouped by save; expired ones are dropped (ROK-1914)', async () => {
    const dto = WowRosterInsightsSchema.parse((await insights('healer')).body);
    const resetAt = new Date(LIVE_RESET_S * 1000).toISOString();
    expect(dto.lockouts).toEqual([
      {
        instanceId: 409,
        difficultyId: 9,
        name: 'Molten Core',
        difficulty: '40 Player',
        total: 10,
        resetAt,
        members: [
          expect.objectContaining({
            characterId: charIds.lead,
            killed: 4,
            resetAt,
          }),
        ],
      },
    ]);
  });

  it('a member gets lastSeen from the latest-snapshot roster (ROK-1916)', async () => {
    const dto = WowRosterInsightsSchema.parse((await insights('lead')).body);
    expect(dto.lastSeen).toEqual({
      reported: 4,
      onlineCount: 2,
      online: [
        { name: 'healer', characterId: charIds.healer },
        { name: 'lead', characterId: charIds.lead },
      ],
      away: [
        { name: 'Pugone', characterId: null, days: 40 },
        { name: 'Pugtwo', characterId: null, days: 2 },
      ],
      snapshotAt: SNAP.toISOString(),
    });
  });

  it('lastSeen uses the full roster even with ?mainsOnly=true (ROK-1916 D4)', async () => {
    const { gid, altId } = await seedAltPresenceGuild();
    const res = await testApp.request
      .get(`/plugins/wow/guilds/${gid}/roster-insights?mainsOnly=true`)
      .set('Authorization', `Bearer ${tokens.lead}`);
    expect(res.status).toBe(200);
    const dto = WowRosterInsightsSchema.parse(res.body);
    // mainsOnly took effect: the alt's Rogue is gone from the breakdown...
    expect(dto.classes.map((c) => c.class)).toEqual(['Warrior']);
    // ...but the online alt still counts and is listed.
    expect(dto.lastSeen).toEqual({
      reported: 2,
      onlineCount: 1,
      online: [{ name: 'Leadalt', characterId: altId }],
      away: [{ name: 'lead', characterId: charIds.lead, days: 5 }],
      snapshotAt: SNAP.toISOString(),
    });
  });

  it('a visitor sees class/level/role but NO professions or lockouts key', async () => {
    const res = await insights('outsider');
    expect(res.status).toBe(200);
    const dto = WowRosterInsightsSchema.parse(res.body);
    expect(dto.classes.length).toBeGreaterThan(0);
    expect('professions' in res.body).toBe(false);
    expect('lockouts' in res.body).toBe(false);
    expect('lockoutReporters' in res.body).toBe(false);
    expect('lastSeen' in res.body).toBe(false);
    expect('gear' in res.body).toBe(false);
  });

  it('a member gets gear readiness over linked cap mains (ROK-1915 AC4)', async () => {
    const dto = WowRosterInsightsSchema.parse((await insights('crafter')).body);
    const gear = dto.gear;
    if (!gear) throw new Error('member payload has no gear key');
    // lead is the only linked cap main; healer (45) and crafter (22) level.
    expect(gear.ilvl).toMatchObject({
      median: 66,
      floor: 55,
      belowCount: 0,
      reporters: 1,
      levelling: 2,
    });
    expect(gear.ilvl.buckets.map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(gear.enchants).toEqual({
      checked: 1,
      unknown: 0,
      missingCount: 1,
      missing: [{ name: 'lead', characterId: charIds.lead, slots: [9] }],
    });
    expect(gear.freshness).toEqual({
      source: 'addon',
      asOf: SNAP.toISOString(),
    });
  });

  it('serves the cached payload until an import of a guild character invalidates it', async () => {
    await insights('lead');
    await testApp.db
      .insert(schema.guildMembers)
      .values(memberRow(guildId, 'Player-7-new', 'Newbie', 12, 'Druid'));
    const cached = WowRosterInsightsSchema.parse((await insights('lead')).body);
    expect(cached.classes.some((c) => c.class === 'Druid')).toBe(false);
    await testApp.app
      .get(RosterInsightsCache)
      .invalidateForCharacter(charIds.lead);
    const fresh = WowRosterInsightsSchema.parse((await insights('lead')).body);
    expect(fresh.classes.find((c) => c.class === 'Druid')?.count).toBe(1);
  });

  it('a first-time (create) import that links a guild member shows on the next read', async () => {
    const fg = await insertGuild(
      'Forever Night Shift',
      await ensureForeverGame(),
    );
    await testApp.db
      .insert(schema.guildMembers)
      .values(memberRow(fg, FIXTURE_GUID, 'Ana Forever', 60, 'Paladin'));
    const before = WowRosterInsightsSchema.parse(
      (await insights('healer', fg)).body,
    );
    expect(before.freshness.characters).toEqual({
      addon: 0,
      blizzard: 0,
      none: 0,
    });
    const res = await testApp.request
      .post('/plugins/wow/characters/addon-import')
      .set('Authorization', `Bearer ${tokens.healer}`)
      .send({
        importString: buildImportString(buildCharPayload()),
        dryRun: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.target.action).toBe('create');
    const after = WowRosterInsightsSchema.parse(
      (await insights('healer', fg)).body,
    );
    expect(after.freshness.characters.addon).toBe(1);
  });

  it('a hidden hub is 404 for a non-staff viewer', async () => {
    const hidden = await insertGuild('Forever Hidden');
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hidden));
    expect((await insights('healer', hidden)).status).toBe(404);
    expect((await insights('outsider', hidden)).status).toBe(404);
  });
});

const LINKED = 300;

/** Link the first LINKED roster rows to characters, each with a snapshot. */
async function linkBigRoster(): Promise<void> {
  const [owner] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'local:big@insights.test', username: 'bigowner' })
      .returning(),
    'owner',
  );
  const chars = await testApp.db
    .insert(schema.characters)
    .values(
      Array.from({ length: LINKED }, (_, i) => ({
        userId: owner.id,
        gameId: testApp.seed.game.id,
        name: `Big${i}`,
        class: i % 2 ? 'Mage' : 'Rogue',
        level: (i % 60) + 1,
        addonGuid: `Player-7-big${i}`,
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        isMain: false,
      })),
    )
    .returning({ id: schema.characters.id });
  await testApp.db.insert(schema.characterAddonSnapshots).values(
    chars.map((c) => ({
      characterId: c.id,
      section: 'char',
      schema: 2,
      data: { gear: [], talents: { nodes: [] }, lockouts: [] },
      capturedAt: SNAP,
      payloadSha256: 'b'.repeat(64),
    })),
  );
}

describe('roster-insights on a 2000-member roster', () => {
  it('computes under the timing guard (p95 logged)', async () => {
    const big = await insertGuild('Forever Two Thousand');
    const rows = Array.from({ length: 2000 }, (_, i) =>
      memberRow(
        big,
        `Player-7-big${i}`,
        `Big${i}`,
        (i % 60) + 1,
        i % 2 ? 'Mage' : 'Rogue',
      ),
    );
    for (let i = 0; i < rows.length; i += 500)
      await testApp.db
        .insert(schema.guildMembers)
        .values(rows.slice(i, i + 500));
    await linkBigRoster();
    const svc = testApp.app.get(RosterInsightsService);
    const times: number[] = [];
    for (let run = 0; run < 10; run += 1) {
      const t0 = performance.now();
      const dto = await svc.compute(big, 'member', false);
      times.push(performance.now() - t0);
      expect(dto.classes.reduce((n, c) => n + c.count, 0)).toBe(2000);
      expect(dto.freshness.characters.addon).toBe(LINKED);
    }
    const p95 =
      [...times].sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1] ?? 0;
    console.log(
      `roster-insights 2000-row (${LINKED} linked) p95=${p95.toFixed(1)}ms`,
    );
    expect(p95).toBeLessThan(1500);
  });
});
