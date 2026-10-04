/**
 * WoW: Forever manual characters (ROK-1721) against a real database:
 * create, cross-user 409 on region + full name, ruleset edit, region lock,
 * and the nightly auto-sync skipping realm-less characters.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { CharactersService } from './characters.service';
import { BlizzardService } from '../plugins/wow-common/blizzard.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';

async function ensureForeverGame(testApp: TestApp): Promise<number> {
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
    'forever game',
  );
  return game.id;
}

async function memberToken(
  testApp: TestApp,
  username: string,
): Promise<{ userId: number; token: string }> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
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
  return { userId: user.id, token: res.body.access_token as string };
}

describe('WoW: Forever manual characters (integration)', () => {
  let testApp: TestApp;
  let gameId: number;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    gameId = await ensureForeverGame(testApp);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  const create = (token: string, body: Record<string, unknown>) =>
    testApp.request
      .post('/users/me/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId, class: 'Paladin', role: 'healer', ...body });

  it('creates a realm-less character with region + ruleset and no game_variant', async () => {
    const { token } = await memberToken(testApp, 'foreverone');
    const res = await create(token, {
      name: ' Ana Forever ',
      region: 'us',
      ruleset: 'pvp',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Ana Forever',
      realm: null,
      region: 'us',
      ruleset: 'pvp',
      gameVariant: null,
    });
  });

  it('409s when another player claims the same region + full name (any case)', async () => {
    const a = await memberToken(testApp, 'forevera');
    const b = await memberToken(testApp, 'foreverb');
    await create(a.token, {
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'pvp',
    });
    const res = await create(b.token, {
      name: 'ana forever',
      region: 'us',
      ruleset: 'normal',
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'ana forever (US) is already claimed by another player',
    );
    const other = await create(b.token, {
      name: 'Ana Forever',
      region: 'eu',
      ruleset: 'pvp',
    });
    expect(other.status).toBe(201);
  });

  it('rejects a single-word name and a missing ruleset', async () => {
    const { token } = await memberToken(testApp, 'foreverbad');
    const single = await create(token, {
      name: 'Ana',
      region: 'us',
      ruleset: 'pvp',
    });
    expect(single.status).toBe(400);
    const noRuleset = await create(token, {
      name: 'Ana Forever',
      region: 'us',
    });
    expect(noRuleset.status).toBe(400);
  });

  it('allows a ruleset edit and rejects a region edit', async () => {
    const { token } = await memberToken(testApp, 'foreveredit');
    const created = await create(token, {
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'pvp',
    });
    const id = created.body.id as string;
    const patch = (body: Record<string, unknown>) =>
      testApp.request
        .patch(`/users/me/characters/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    const ok = await patch({ ruleset: 'normal' });
    expect(ok.status).toBe(200);
    expect(ok.body.ruleset).toBe('normal');

    const locked = await patch({ region: 'eu' });
    expect(locked.status).toBe(400);
    const [row] = await testApp.db
      .select({ region: schema.characters.region })
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(row?.region).toBe('us');
  });

  it('nightly auto-sync never calls Blizzard for a realm-less character', async () => {
    const { userId } = await memberToken(testApp, 'foreversync');
    // Worst case: a row that also carries game_variant (the old selection key).
    await testApp.db.insert(schema.characters).values({
      userId,
      gameId,
      name: 'Ana Forever',
      realm: null,
      region: 'us',
      ruleset: 'pvp',
      gameVariant: 'wow_forever',
      isMain: true,
    });
    const blizzard = testApp.app.get(BlizzardService);
    const fetchProfile = jest.spyOn(blizzard, 'fetchCharacterProfile');
    const result = await testApp.app.get(CharactersService).syncAllCharacters();
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });
});
