/**
 * ROK-1917 (W10 "Raid progress") — `GET /plugins/wow/guilds/:id/roster-insights`
 * `raidProgress` against a real DB. Its own guild and users (split from
 * `roster-insights.integration.spec.ts`, which is near the 750-line limit).
 *
 * AC1: only pulls of this hub's game + region + guild key count, and only when
 * a linked roster user (or a since-deleted user) reported them (Q1).
 * AC3: two stored pulls 1 s apart count once; 11 s apart count twice.
 * AC4: members get the key; a visitor's payload has NO `raidProgress` key.
 */
import { WowRosterInsightsSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { RosterInsightsCache } from './roster-insights.cache';

const GUILD_NAME = 'Raid Progress 1917';
const GUILD_KEY = GUILD_NAME.toLowerCase();
const T0 = Date.parse('2026-10-22T20:00:00.000Z');
const at = (s: number): Date => new Date(T0 + s * 1000);

type Who = 'raider' | 'pug' | 'visitor';

let testApp: TestApp;
let guildId: number;
let otherGameId: number;
const userIds = new Map<Who, number>();
const tokens = new Map<Who, string>();

function idOf(who: Who): number {
  const id = userIds.get(who);
  if (id === undefined) throw new Error(`no user ${who}`);
  return id;
}

/** A user; `raider` also gets a linked character on the guild roster. */
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
  if (who === 'raider') await seedRosterChar(user.id);
}

async function seedRosterChar(userId: number): Promise<void> {
  const guid = 'Player-7-rp1917raider';
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

const insights = (who: Who) =>
  testApp.request
    .get(`/plugins/wow/guilds/${guildId}/roster-insights`)
    .set('Authorization', `Bearer ${tokens.get(who) ?? ''}`);

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild();
  otherGameId = await insertOtherGame();
  for (const who of ['raider', 'pug', 'visitor'] as const) await seedUser(who);
  await testApp.db
    .insert(schema.addonEncounterPulls)
    .values([...IN_SCOPE, ...outOfScope()].map(pullRow));
  testApp.app.get(RosterInsightsCache).invalidateGuild(guildId);
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
});
