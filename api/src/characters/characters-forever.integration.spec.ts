/**
 * WoW: Forever manual characters (ROK-1721) against a real database:
 * create, cross-user 409 on region + full name (pre-check AND the DB index
 * on its own), rename 409, Hardcore 400, ruleset edit, region lock,
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
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

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

/** Upsert plugin rows and reload the registry's active cache, as an API restart does. */
async function setPluginsActive(
  testApp: TestApp,
  rows: { slug: string; active: boolean }[],
): Promise<void> {
  const registry = testApp.app.get(PluginRegistryService);
  for (const { slug, active } of rows) {
    const manifest = registry.getManifest(slug);
    await testApp.db
      .insert(schema.plugins)
      .values({
        slug,
        name: manifest?.name ?? slug,
        version: manifest?.version ?? '0.0.0',
        active,
      })
      .onConflictDoUpdate({
        target: schema.plugins.slug,
        set: { active, updatedAt: new Date() },
      });
  }
  await registry.onModuleInit();
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
      'Ana Forever (US) is already claimed by another player',
    );
    const other = await create(b.token, {
      name: 'Ana Forever',
      region: 'eu',
      ruleset: 'pvp',
    });
    expect(other.status).toBe(201);
  });

  it('the DB index alone rejects a second Forever row with the same region + name (any case)', async () => {
    const a = await memberToken(testApp, 'foreverdba');
    const b = await memberToken(testApp, 'foreverdbb');
    const row = { gameId, realm: null, region: 'us', ruleset: 'pvp' as const };
    await testApp.db
      .insert(schema.characters)
      .values({ ...row, userId: a.userId, name: 'Ana Forever' });
    const err: unknown = await testApp.db
      .insert(schema.characters)
      .values({ ...row, userId: b.userId, name: 'ANA FOREVER' })
      .then(
        () => null,
        (e: unknown) => e,
      );
    const e = err as (Error & { cause?: Error }) | null;
    expect(`${e?.message ?? 'no error'} ${e?.cause?.message ?? ''}`).toContain(
      'idx_characters_ruleset_identity',
    );
  });

  it("409s when a rename lands on another player's full name", async () => {
    const a = await memberToken(testApp, 'foreverrena');
    const b = await memberToken(testApp, 'foreverrenb');
    await create(a.token, {
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'pvp',
    });
    const mine = await create(b.token, {
      name: 'Bea Forever',
      region: 'us',
      ruleset: 'pvp',
    });
    const res = await testApp.request
      .patch(`/users/me/characters/${mine.body.id as string}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'ana forever' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'Ana Forever (US) is already claimed by another player',
    );
  });

  it('rejects the not-yet-open Hardcore ruleset on create', async () => {
    const { token } = await memberToken(testApp, 'foreverhc');
    const res = await create(token, {
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'hardcore',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a region on an update to a non-Forever character', async () => {
    const { userId, token } = await memberToken(testApp, 'retailregion');
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Not Forever', slug: 'not-forever-1721' })
        .returning(),
      'other game',
    );
    const [char] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({ userId, gameId: game.id, name: 'Thrall', isMain: true })
        .returning(),
      'retail character',
    );
    const res = await testApp.request
      .patch(`/users/me/characters/${char.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ region: 'eu' });
    expect(res.status).toBe(400);
    const [row] = await testApp.db
      .select({ region: schema.characters.region })
      .from(schema.characters)
      .where(eq(schema.characters.id, char.id));
    expect(row?.region).toBeNull();
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

  it('treats Forever as a plain game while the WoW plugin is off after a restart', async () => {
    const registry = testApp.app.get(PluginRegistryService);
    const wasActive = [...registry.getActiveSlugsSync()];
    await setPluginsActive(testApp, [{ slug: 'blizzard', active: false }]);
    try {
      // The boot-time registration is still there; only the plugin is off.
      expect(
        registry.getAdapter('character-identity', FOREVER_SLUG),
      ).toBeDefined();
      const { token } = await memberToken(testApp, 'foreverplain');
      const plain = await create(token, { name: 'Ana' });
      expect(plain.status).toBe(201);
      expect(plain.body).toMatchObject({ name: 'Ana', region: null });
      const withIdentity = await create(token, {
        name: 'Ana Forever',
        region: 'us',
        ruleset: 'pvp',
      });
      expect(withIdentity.status).toBe(400);
      expect(withIdentity.body.message).toBe(
        'Region and ruleset do not apply to this game',
      );
    } finally {
      await setPluginsActive(
        testApp,
        wasActive.map((slug) => ({ slug, active: true })),
      );
    }
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
