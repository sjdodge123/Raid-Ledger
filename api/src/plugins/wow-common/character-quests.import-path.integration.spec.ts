/**
 * ROK-1745 AC3: the quest section is fed by the REAL LedgerLink import path.
 * The golden `char-forever-quests` fixture is posted through
 * `POST /plugins/wow/characters/:id/addon-import` (ROK-1742), then
 * `GET /plugins/wow/characters/:id/quests` returns a populated `{ quests }`.
 * Direct-insert cases live in `character-quests.integration.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { CharacterQuestsResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

const FIXTURE = join(
  __dirname,
  '../../../../packages/contract/ledgerlink/v1/fixtures/char-forever-quests.txt',
);

let testApp: TestApp;

async function ensureGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return existing.id;
  const rows = await testApp.db
    .insert(schema.games)
    .values({ name: 'World of Warcraft: Forever', slug: WOW_FOREVER_GAME_SLUG })
    .returning();
  return nonEmpty(rows, 'game')[0].id;
}

/** A local member; returns their JWT. */
async function memberToken(username: string): Promise<string> {
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

/** Known classic quests: 456 is in the fixture's completed ids, 2459 in its log. */
async function seedKnownQuests(): Promise<void> {
  await testApp.db.insert(schema.wowClassicDungeonQuests).values([
    {
      questId: 456,
      dungeonInstanceId: 226,
      name: 'RFC Known',
      expansion: 'classic',
      questLevel: 15,
    },
    {
      questId: 2459,
      dungeonInstanceId: 63,
      name: 'VC Known',
      expansion: 'classic',
      questLevel: 20,
    },
  ]);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await seedKnownQuests();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('GET /plugins/wow/characters/:id/quests — real import path (AC3)', () => {
  it('serves quests stored by the LedgerLink addon import', async () => {
    const token = await memberToken('questimport');
    const created = await testApp.request
      .post('/users/me/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        gameId: await ensureGame(),
        name: 'Ana Forever',
        class: 'Paladin',
        region: 'us',
        ruleset: 'normal',
      });
    expect(created.status).toBe(201);
    const charId = created.body.id as string;
    const imported = await testApp.request
      .post(`/plugins/wow/characters/${charId}/addon-import`)
      .set('Authorization', `Bearer ${token}`)
      .send({ importString: readFileSync(FIXTURE, 'utf8'), dryRun: false });
    expect(imported.status).toBe(200);

    const res = await testApp.request.get(
      `/plugins/wow/characters/${charId}/quests`,
    );
    expect(res.status).toBe(200);
    const quests = CharacterQuestsResponseSchema.parse(res.body).quests;
    expect(quests).not.toBeNull();
    expect(quests?.counts).toMatchObject({
      completedTotal: 10_000,
      inProgress: 3,
    });
    const rfc = quests?.completedKnown.find((g) => g.dungeonInstanceId === 226);
    expect(rfc?.completed.map((q) => q.questId)).toEqual([456]);
    expect(quests?.inProgress.find((q) => q.questId === 2459)).toMatchObject({
      title: 'Ferocitas the Dream Eater',
      dungeonInstanceId: 63,
      instanceName: 'Deadmines',
    });
  });
});
