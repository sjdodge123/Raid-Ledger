/**
 * ROK-2133 AC-9 — `POST /plugins/wow/roster-claim/members/:memberId/claim`
 * against a real database: a claimed roster member's verified Armory snapshot
 * (`guild_member_armory`) is copied onto the new character — Armory columns,
 * `game_variant='wow_forever'`, `external_id`, `last_synced_at` = snapshot
 * time — even when the live Armory refresh after the claim throws. A snapshot
 * verified against a different Blizzard id than the member's is never copied.
 */
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { CharactersService } from '../../../../characters/characters.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');
const SYNCED = new Date('2026-11-06T09:30:00.000Z');
const LOGIN = new Date('2026-11-05T21:00:00.000Z');
const BODY = { ruleset: 'normal' };
const EQUIPMENT = {
  equippedItemLevel: 64,
  items: [
    {
      slot: 'HEAD',
      name: 'Lionheart Helm',
      itemId: 12640,
      quality: 'EPIC',
      itemLevel: 63,
      itemSubclass: null,
    },
  ],
  syncedAt: SYNCED.toISOString(),
};
const TALENTS = { specs: [{ name: 'Protection', points: 31 }] };
const PROFESSIONS = {
  primary: [
    {
      id: 164,
      name: 'Blacksmithing',
      slug: 'blacksmithing',
      skillLevel: 300,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: SYNCED.toISOString(),
};

let testApp: TestApp;
let foreverId: number;
let guildId: number;
const members = new Map<string, number>();

async function ensureGame(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertGuild(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAPSHOT,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

async function insertMember(name: string, blizzardId: number): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        characterName: name,
        blizzardCharacterId: blizzardId,
        source: 'blizzard',
        class: 'Warrior',
        level: 58,
        lastSeenAt: SNAPSHOT,
      })
      .returning({ id: schema.guildMembers.id }),
    'member',
  );
  members.set(name, m.id);
  return m.id;
}

/** A synced snapshot for `memberId`, verified against `blizzardId`. */
async function insertSnapshot(
  memberId: number,
  blizzardId: number,
): Promise<void> {
  await testApp.db.insert(schema.guildMemberArmory).values({
    guildMemberId: memberId,
    blizzardCharacterId: blizzardId,
    level: 60,
    class: 'Warrior',
    race: 'Human',
    spec: 'Protection',
    role: 'tank',
    itemLevel: 64,
    avatarUrl: 'https://render.example/avatar.jpg',
    equipment: EQUIPMENT,
    talents: TALENTS,
    armoryProfessions: PROFESSIONS,
    lastLoginAt: LOGIN,
    syncedAt: SYNCED,
    lastAttemptAt: SYNCED,
  });
}

function memberId(name: string): number {
  const id = members.get(name);
  if (id === undefined) throw new Error(`no seeded member ${name}`);
  return id;
}

async function makeUser(handle: string): Promise<string> {
  const email = `${handle}@roster-claim-armory.test`.toLowerCase();
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: handle, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token: unknown = res.body.access_token;
  if (typeof token !== 'string') {
    throw new Error(`makeUser(${handle}): /auth/local ${res.status}, no token`);
  }
  return token;
}

const claim = (id: number, token: string) =>
  testApp.request
    .post(`/plugins/wow/roster-claim/members/${id}/claim`)
    .set('Authorization', `Bearer ${token}`)
    .send(BODY);

async function characterNamed(name: string) {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.gameId, foreverId),
          eq(schema.characters.name, name),
        ),
      ),
    `character ${name}`,
  );
  return row;
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureGame();
  guildId = await insertGuild('Armory Claim Guild');
  await insertSnapshot(await insertMember('Snap Holder', 7101), 7101);
  await insertSnapshot(await insertMember('Snap Stale', 7202), 7999);
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

let refresh: jest.SpyInstance;

beforeEach(() => {
  refresh = jest
    .spyOn(testApp.app.get(CharactersService), 'refreshExternal')
    .mockRejectedValue(new Error('Armory upstream down'));
});

afterEach(() => refresh.mockRestore());

describe('roster claim copies the member Armory snapshot (ROK-2133 AC-9)', () => {
  it('copies the verified snapshot even when the live refresh throws', async () => {
    const res = await claim(memberId('Snap Holder'), await makeUser('a9copy'));
    expect(res.status).toBe(201);
    expect(refresh).toHaveBeenCalledTimes(1);
    const row = await characterNamed('Snap Holder');
    expect(row).toMatchObject({
      gameVariant: 'wow_forever',
      externalId: '7101',
      lastSyncedAt: SYNCED,
      level: 60,
      class: 'Warrior',
      race: 'Human',
      spec: 'Protection',
      role: 'tank',
      itemLevel: 64,
      avatarUrl: 'https://render.example/avatar.jpg',
      equipment: EQUIPMENT,
      talents: TALENTS,
      armoryProfessions: PROFESSIONS,
    });
    // The refresh failed, so the response is the copied row.
    expect(res.body).toMatchObject({
      id: row.id,
      itemLevel: 64,
      gameVariant: 'wow_forever',
      lastSyncedAt: SYNCED.toISOString(),
    });
  });

  it('copies nothing when the snapshot was verified against another Blizzard id', async () => {
    const res = await claim(memberId('Snap Stale'), await makeUser('a9stale'));
    expect(res.status).toBe(201);
    const row = await characterNamed('Snap Stale');
    expect(row).toMatchObject({
      externalId: '7202',
      gameVariant: null,
      lastSyncedAt: null,
      itemLevel: null,
      spec: null,
      equipment: null,
      armoryProfessions: null,
    });
    expect(row.level).toBe(58);
  });
});
