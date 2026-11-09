/**
 * ROK-2128 L1 — `GET /plugins/wow/roster-claim/candidates?gameId=` against a
 * real database: FLAG 1 visibility (hidden / archived guilds excluded), the
 * D2 unclaimed predicate (GUID, Blizzard id, case-insensitive name, other
 * region, soft-removed), FLAG 2 row shape, the 1000 cap, non-Forever games
 * and auth. L2 extends this file with the claim + race cases.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');
const STALE = new Date('2026-10-01T00:00:00Z');
const URL = '/plugins/wow/roster-claim/candidates';

interface CandidateBody {
  memberId: number;
  name: string;
}
interface GuildBody {
  guildId: number;
  guildName: string;
  region: string;
  candidates: CandidateBody[];
}

let testApp: TestApp;
let foreverId: number;
let token: string;
let ownerId: number;
let alphaId: number;
let hiddenId: number;
let archivedId: number;

async function ensureGame(slug: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertGuild(
  name: string,
  extra: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<number> {
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
        ...extra,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

type MemberSeed = Partial<typeof schema.guildMembers.$inferInsert> & {
  characterName: string;
};

async function insertMembers(guildId: number, rows: MemberSeed[]) {
  await testApp.db.insert(schema.guildMembers).values(
    rows.map((r) => ({
      guildId,
      source: 'addon_import',
      lastSeenAt: SNAPSHOT,
      ...r,
    })),
  );
}

/** A local-login member; returns its id and access token. */
async function makeUser(
  handle: string,
): Promise<{ id: number; token: string }> {
  const email = `${handle}@roster-claim.test`;
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
  return { id: user.id, token: res.body.access_token as string };
}

async function ownCharacter(
  name: string,
  extra: Partial<typeof schema.characters.$inferInsert>,
): Promise<void> {
  await testApp.db
    .insert(schema.characters)
    .values({ userId: ownerId, gameId: foreverId, name, ...extra });
}

async function seedAlpha(): Promise<void> {
  alphaId = await insertGuild('Alpha Guild');
  await insertMembers(alphaId, [
    { characterName: 'Ashen Vale', guid: 'G-ASHEN', rankName: 'Officer' },
    {
      characterName: 'Brine Hollow',
      blizzardCharacterId: 555,
      source: 'blizzard',
    },
    { characterName: 'Guid Taken', guid: 'G-TAKEN' },
    { characterName: 'Guid Elsewhere', guid: 'G-EU' },
    {
      characterName: 'Blizz Taken',
      blizzardCharacterId: 777,
      source: 'blizzard',
    },
    { characterName: 'Name Taken' },
    { characterName: 'Gone Member', guid: 'G-GONE', lastSeenAt: STALE },
  ]);
  await ownCharacter('Guid Alt', { addonGuid: 'G-TAKEN', region: 'us' });
  await ownCharacter('Euro Alt', { addonGuid: 'G-EU', region: 'eu' });
  await ownCharacter('Blizz Alt', { externalId: '777', region: 'us' });
  await ownCharacter('name taken', { region: 'US' });
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureGame(FOREVER_SLUG);
  ownerId = (await makeUser('rosterowner')).id;
  token = (await makeUser('rosterpicker')).token;
  await seedAlpha();
  hiddenId = await insertGuild('Hidden Guild', { hiddenAt: SNAPSHOT });
  archivedId = await insertGuild('Archived Guild', { archivedAt: SNAPSHOT });
  await insertMembers(hiddenId, [{ characterName: 'Hidden One', guid: 'G-H' }]);
  await insertMembers(archivedId, [
    { characterName: 'Archived One', guid: 'G-A' },
  ]);
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

const list = (gameId: number | string, auth = token) =>
  testApp.request
    .get(`${URL}?gameId=${gameId}`)
    .set('Authorization', `Bearer ${auth}`);

interface ListBody {
  guilds: GuildBody[];
  truncated: boolean;
}

/** The listed section of one guild, if any. */
function guildOf(res: { body: unknown }, id: number): GuildBody | undefined {
  return (res.body as ListBody).guilds.find((g) => g.guildId === id);
}

describe('GET /plugins/wow/roster-claim/candidates (ROK-2128)', () => {
  it('lists only unclaimed, live rows, sorted by name (D2)', async () => {
    const res = await list(foreverId);
    expect(res.status).toBe(200);
    const alpha = guildOf(res, alphaId);
    expect(alpha?.guildName).toBe('Alpha Guild');
    expect(alpha?.region).toBe('us');
    expect(alpha?.candidates.map((c) => c.name)).toEqual([
      'Ashen Vale',
      'Brine Hollow',
      'Guid Elsewhere',
    ]);
  });

  it('excludes hidden and archived guilds (FLAG 1)', async () => {
    const res = await list(foreverId);
    const ids = (res.body.guilds as GuildBody[]).map((g) => g.guildId);
    expect(ids).toContain(alphaId);
    expect(ids).not.toContain(hiddenId);
    expect(ids).not.toContain(archivedId);
  });

  it('a candidate carries name/class/level/source only — never rank (FLAG 2)', async () => {
    const res = await list(foreverId);
    const ashen = guildOf(res, alphaId)?.candidates[0];
    expect(ashen).toEqual({
      memberId: expect.any(Number),
      name: 'Ashen Vale',
      class: null,
      level: null,
      source: 'addon_import',
    });
  });
});

describe('GET /plugins/wow/roster-claim/candidates — scope + access (ROK-2128)', () => {
  it('a non-Forever game lists nothing', async () => {
    const res = await list(testApp.seed.game.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ guilds: [], truncated: false });
  });

  it('a bad gameId is a 400', async () => {
    expect((await list('abc')).status).toBe(400);
  });

  it('requires a session (401)', async () => {
    const res = await testApp.request.get(`${URL}?gameId=${foreverId}`);
    expect(res.status).toBe(401);
  });

  it('a deactivated caller is refused by the JWT strategy (401)', async () => {
    const gone = await makeUser('rosterdeactivated');
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gone.id));
    expect((await list(foreverId, gone.token)).status).toBe(401);
  });
});

describe('GET /plugins/wow/roster-claim/candidates — cap (ROK-2128)', () => {
  it('caps the list at 1000 candidates and flags truncated', async () => {
    const bigId = await insertGuild('Zz Big Guild');
    try {
      const names = Array.from({ length: 1001 }, (_, i) => ({
        characterName: `Big ${String(i).padStart(4, '0')}`,
        guid: `G-BIG-${i}`,
      }));
      await insertMembers(bigId, names);
      const res = await list(foreverId);
      expect(res.body.truncated).toBe(true);
      const total = (res.body.guilds as GuildBody[]).reduce(
        (n, g) => n + g.candidates.length,
        0,
      );
      expect(total).toBe(1000);
      // Codex P2: `q` filters BEFORE the cap — the 1001st row is findable.
      const found = await list(`${foreverId}&q=big%201000`);
      expect(found.body.truncated).toBe(false);
      expect(guildOf(found, bigId)?.candidates.map((c) => c.name)).toEqual([
        'Big 1000',
      ]);
    } finally {
      await testApp.db.delete(schema.guilds).where(eq(schema.guilds.id, bigId));
    }
  });
});

describe('GET /plugins/wow/roster-claim/candidates?guildId= (ROK-2132)', () => {
  let betaId: number;

  beforeAll(async () => {
    betaId = await insertGuild('Beta Guild');
    await insertMembers(betaId, [{ characterName: 'Beta One', guid: 'G-B1' }]);
  });

  const listGuild = (guildId: number | string) =>
    list(`${foreverId}&guildId=${guildId}`);

  it('omitted, every claimable guild is listed (unchanged)', async () => {
    const res = await list(foreverId);
    const ids = (res.body.guilds as GuildBody[]).map((g) => g.guildId);
    expect(ids).toEqual(expect.arrayContaining([alphaId, betaId]));
  });

  it('narrows to that one guild', async () => {
    const res = await listGuild(alphaId);
    expect(res.status).toBe(200);
    const ids = (res.body.guilds as GuildBody[]).map((g) => g.guildId);
    expect(ids).toEqual([alphaId]);
    expect(guildOf(res, alphaId)?.candidates.map((c) => c.name)).toEqual([
      'Ashen Vale',
      'Brine Hollow',
      'Guid Elsewhere',
    ]);
    expect(res.body.truncated).toBe(false);
  });

  it.each([
    ['hidden', () => hiddenId],
    ['archived', () => archivedId],
    ['unknown', () => 999999],
  ])('a %s guild id lists nothing (never 404)', async (_label, id) => {
    const res = await listGuild(id());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ guilds: [], truncated: false });
  });

  it('a guild of another game lists nothing', async () => {
    const [other] = nonEmpty(
      await testApp.db
        .insert(schema.guilds)
        .values({
          gameId: testApp.seed.game.id,
          region: 'us',
          name: 'Retail Guild',
          nameKey: 'retail guild',
          source: 'addon_import',
          lastSnapshotAt: SNAPSHOT,
        })
        .returning({ id: schema.guilds.id }),
      'retail guild',
    );
    await insertMembers(other.id, [{ characterName: 'Retail One' }]);
    expect((await listGuild(other.id)).body).toEqual({
      guilds: [],
      truncated: false,
    });
  });

  it('a bad guildId is a 400', async () => {
    expect((await listGuild('abc')).status).toBe(400);
  });
});
