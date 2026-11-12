/**
 * ROK-1927 (P3) — the members-only `attunements` section of
 * `GET /plugins/wow/guilds/:id/roster-insights` against a real DB: a Forever
 * guild with a claimed Orc main whose Armory list completes Molten Core, a
 * claimed Undead main mid-Onyxia via the LedgerLink quest log, an unclaimed
 * roster member, and a visitor. Blackwing Lair's final quest has no stored
 * Blizzard row, so it is hidden (Lead call 2026-11-12).
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { WowRosterInsightsSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-11-04T20:00:00.000Z');
const FOREVER_SLUG = 'world-of-warcraft-forever';
/** MC Horde final, Onyxia Horde first + final; NOT BWL's 7761. */
const CONFIRMED = [7487, 4903, 4941, 6602];
type Who = 'orc' | 'undead' | 'outsider';

let testApp: TestApp;
let gameId: number;
let guildId: number;
const tokens: Partial<Record<Who, string>> = {};

function tokenOf(who: Who): string {
  const token = tokens[who];
  if (token === undefined) throw new Error(`no token for ${who}`);
  return token;
}

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

function memberRow(guid: string, name: string, level: number) {
  return {
    guildId,
    guid,
    characterName: name,
    level,
    class: 'Warrior',
    rankIndex: 2,
    rankName: 'Raider',
    source: 'addon_import',
    lastSeenAt: SNAP,
  };
}

/** A local-login user with a Forever main; members also get a roster row. */
async function seedUser(
  who: Who,
  race: string,
  extra: Partial<typeof schema.characters.$inferInsert> = {},
): Promise<string> {
  const email = `${who}@attune1927.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: `a1927${who}` })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const guid = `Player-7-a1927${who}`;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId,
        name: `A1927${who}`,
        class: 'Warrior',
        race,
        level: 60,
        addonGuid: guid,
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        isMain: true,
        ...extra,
      })
      .returning(),
    'character',
  );
  if (who !== 'outsider')
    await testApp.db
      .insert(schema.guildMembers)
      .values(memberRow(guid, `A1927${who}`, 60));
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token: unknown = res.body.access_token;
  if (typeof token !== 'string') throw new Error(`login failed for ${who}`);
  tokens[who] = token;
  return char.id;
}

async function seedConfirmedQuests(): Promise<void> {
  await testApp.db
    .insert(schema.wowDungeonQuestBlizzard)
    .values(
      CONFIRMED.map((questId) => ({
        questId,
        areaId: 0,
        title: `Quest ${questId}`,
        raw: {},
        fetchedAt: SNAP,
        runId: 'rok-1927',
      })),
    )
    .onConflictDoNothing();
}

const insights = (who: Who) =>
  testApp.request
    .get(`/plugins/wow/guilds/${guildId}/roster-insights`)
    .set('Authorization', `Bearer ${tokenOf(who)}`);

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  gameId = await ensureForeverGame();
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        region: 'us',
        name: 'Attune 1927',
        nameKey: 'attune 1927',
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  guildId = g.id;
  await seedConfirmedQuests();
  await seedUser('orc', 'Orc', {
    armoryQuests: { fetchedAt: SNAP.toISOString(), completed: [7487] },
  });
  const undead = await seedUser('undead', 'Undead');
  await seedUser('outsider', 'Orc');
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId: undead,
    section: 'char',
    schema: 2,
    data: {
      gear: [],
      talents: { nodes: [] },
      lockouts: [],
      quests: { completed: [4903], inProgress: [{ questId: 4941 }] },
    },
    capturedAt: SNAP,
    payloadSha256: 'b'.repeat(64),
  });
  await testApp.db
    .insert(schema.guildMembers)
    .values(memberRow('Player-7-a1927pug', 'A1927pug', 50));
});

function result(
  dto: ReturnType<typeof WowRosterInsightsSchema.parse>,
  name: string,
  key: string,
) {
  const member = dto.attunements?.members.find((m) => m.name === name);
  return member?.results.find((r) => r.key === key);
}

describe('roster-insights attunements (ROK-1927, real DB)', () => {
  it('a member gets contract-valid verdicts per faction', async () => {
    const res = await insights('orc');
    expect(res.status).toBe(200);
    const dto = WowRosterInsightsSchema.parse(res.body);
    expect(result(dto, 'A1927orc', 'mc-horde')?.state).toBe('done');
    expect(result(dto, 'A1927orc', 'ony-horde')?.state).toBe('not_started');
    expect(result(dto, 'A1927undead', 'ony-horde')).toMatchObject({
      state: 'in_progress',
      stepsDone: 1,
      nextStep: "Eitrigg's Wisdom",
    });
    expect(result(dto, 'A1927undead', 'mc-alliance')).toBeUndefined();
  });

  it('an unclaimed roster member is no_data not_claimed', async () => {
    const dto = WowRosterInsightsSchema.parse((await insights('orc')).body);
    const pug = dto.attunements?.members.find((m) => m.name === 'A1927pug');
    expect(pug?.characterId).toBeNull();
    expect(result(dto, 'A1927pug', 'mc-horde')).toMatchObject({
      state: 'no_data',
      noDataReason: 'not_claimed',
    });
    const mc = dto.attunements?.attunements.find((a) => a.key === 'mc-horde');
    expect(mc?.counts).toEqual({
      done: 1,
      inProgress: 0,
      notStarted: 1,
      noData: 1,
    });
  });

  it('hides an attunement whose final quest has no stored Blizzard row', async () => {
    const dto = WowRosterInsightsSchema.parse((await insights('orc')).body);
    const keys = dto.attunements?.attunements.map((a) => a.key);
    expect(keys).toEqual(['mc-horde', 'ony-horde', 'naxx']);
    expect(JSON.stringify(dto.attunements)).not.toMatch(/\b(7487|4903|6602)\b/);
  });

  it('a visitor gets no attunements key', async () => {
    const res = await insights('outsider');
    expect(res.status).toBe(200);
    expect('attunements' in res.body).toBe(false);
  });
});
