/**
 * ROK-2124 L4 — the LedgerLink import nudges the Forever Armory auto-link
 * after commit (create + per-character routes), never on a dry run. The
 * nudge is fire-and-forget; the spec awaits the promise the spied
 * `attempt` returned instead of sleeping. Blizzard is stubbed at the
 * `BlizzardCharacterSyncAdapter` instance the app holds.
 */
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BlizzardCharacterSyncAdapter } from '../blizzard-character-sync.adapter';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';
import { ForeverAutoLinkService } from '../forever-auto-link/forever-auto-link.service';
import { buildCharPayload, buildImportString } from './testing/addon-fixture.builder';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

let testApp: TestApp;
let gameId: number;
let attempt: jest.SpyInstance;
let fetchProfile: jest.SpyInstance;

async function ensureGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: WOW_FOREVER_GAME_SLUG })
      .returning(),
    'game',
  );
  return game.id;
}

async function member(username: string): Promise<string> {
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
  const login = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return login.body.access_token as string;
}

async function handMade(token: string): Promise<string> {
  const res = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId,
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const importString = () => buildImportString(buildCharPayload());

const post = (token: string, path: string, dryRun: boolean) =>
  testApp.request
    .post(`/plugins/wow/characters/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: importString(), dryRun });

/** The outcome of the single nudge this import fired. */
async function nudgeOutcome(): Promise<unknown> {
  expect(attempt).toHaveBeenCalledTimes(1);
  return attempt.mock.results[0]?.value;
}

const charRow = async (id: string) =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, id)),
    'character',
  )[0];

const stateRows = () =>
  testApp.db.select().from(schema.wowForeverArmoryAutolink);

function stubBlizzard(): void {
  const adapter = testApp.app.get(BlizzardCharacterSyncAdapter);
  fetchProfile = jest.spyOn(adapter, 'fetchProfile').mockResolvedValue({
    name: 'Ana Forever',
    realm: null,
    class: '',
    spec: null,
    role: null,
    level: 60,
    race: 'Human',
    faction: 'Alliance',
    itemLevel: 60,
    avatarUrl: null,
    renderUrl: null,
    profileUrl: null,
    externalId: '7001',
  });
  jest.spyOn(adapter, 'fetchEquipment').mockResolvedValue(null);
  jest.spyOn(adapter, 'fetchProfessions').mockResolvedValue(null);
  jest.spyOn(adapter, 'fetchQuests').mockResolvedValue(null);
  const settings = testApp.app.get(SettingsService);
  jest.spyOn(settings, 'isBlizzardConfigured').mockResolvedValue(true);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  stubBlizzard();
  attempt = jest.spyOn(testApp.app.get(ForeverAutoLinkService), 'attempt');
});

afterEach(async () => {
  jest.restoreAllMocks();
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('create route (AC-1)', () => {
  it('a dry run fires no nudge', async () => {
    const token = await member('nudgedry');
    const res = await post(token, 'addon-import', true);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('preview');
    expect(attempt).not.toHaveBeenCalled();
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it('an apply nudges once for the NEW character, which ends Armory-linked', async () => {
    const token = await member('nudgecreate');
    const res = await post(token, 'addon-import', false);
    expect(res.body.status).toBe('applied');
    const id = res.body.target.characterId as string;
    expect(attempt).toHaveBeenCalledWith(id);
    expect(await nudgeOutcome()).toBe('linked');
    expect(await charRow(id)).toMatchObject({
      gameVariant: 'wow_forever',
      externalId: '7001',
      name: 'Ana Forever',
    });
  });

  it('a 404 still answers the import as applied and backs the row off (AC-4)', async () => {
    fetchProfile.mockRejectedValue(new NotFoundException('hidden'));
    const token = await member('nudge404');
    const res = await post(token, 'addon-import', false);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    const id = res.body.target.characterId as string;
    expect(await nudgeOutcome()).toBe('not_found');
    expect((await charRow(id)).gameVariant).toBeNull();
    const rows = await stateRows();
    expect(rows.map((r) => [r.characterId, r.failures, r.lastError])).toEqual([
      [id, 1, 'not_found'],
    ]);
  });
});

describe('per-character route (AC-2, AC-7)', () => {
  it('binding a hand-made row nudges for that row and links it', async () => {
    const token = await member('nudgebind');
    const id = await handMade(token);
    const res = await post(token, `${id}/addon-import`, false);
    expect(res.status).toBe(200);
    expect(attempt).toHaveBeenCalledWith(id);
    expect(await nudgeOutcome()).toBe('linked');
    expect((await charRow(id)).gameVariant).toBe('wow_forever');
  });

  it('an already Armory-linked row makes no Blizzard call and no state row', async () => {
    const token = await member('nudgelinked');
    const id = await handMade(token);
    await testApp.db
      .update(schema.characters)
      .set({ gameVariant: 'wow_forever' })
      .where(eq(schema.characters.id, id));
    const res = await post(token, `${id}/addon-import`, false);
    expect(res.status).toBe(200);
    expect(await nudgeOutcome()).toBe('skipped');
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(await stateRows()).toEqual([]);
  });
});
