/**
 * ROK-1760 — addon gear before Wowhead resolves: a real addon import whose
 * gear carries raw item links renders the LINK's name + quality on
 * GET /characters/:id with `resolved:false` (not "Item #id"), and a resolved
 * Wowhead row still wins. The TestApp's no-network Wowhead deps answer every
 * lookup with a 404, so the post-commit enqueue stores `not_found` rows.
 * Request shape + auth mirror `characters-forever-talents-import.integration.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import * as bcrypt from 'bcrypt';
import { eq, inArray } from 'drizzle-orm';
import type {
  AddonCharExport,
  CharacterEquipmentDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { buildImportString } from '../plugins/wow-common/addon-import/testing/addon-fixture.builder';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURE = join(
  __dirname,
  '../../../packages/contract/ledgerlink/v1/fixtures/char-forever-quests.txt',
);
const SHIRT_LINK =
  "|cnIQ1:|Hitem:6120::::::::1:::::::::|h[Recruit's Shirt]|h|r";
const HELM_LINK =
  '|cnIQ4:|Hitem:16921::::::::60:::::::::|h[Halo of\u0007 Transcendence]|h|r';

/** The golden Forever fixture with its gear replaced by two linked items. */
function gearExport(): string {
  const body = readFileSync(FIXTURE, 'utf8').trim().split('!').pop();
  const payload = JSON.parse(
    inflateSync(Buffer.from(body ?? '', 'base64')).toString('utf8'),
  ) as AddonCharExport;
  payload.data.gear = [
    { slot: 4, itemId: 6120, link: SHIRT_LINK, ilvl: 1 },
    { slot: 1, itemId: 16921, link: HELM_LINK, ilvl: 76 },
  ];
  return buildImportString(payload);
}

let testApp: TestApp;

async function ensureGame(): Promise<number> {
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

/** A local-credential member and their bearer token. */
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

/** Create a Forever character and import the linked-gear export onto it. */
async function importLinkedGear(): Promise<string> {
  const gameId = await ensureGame();
  const token = await member('gearfallback');
  const created = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId,
      name: 'Ana Forever', // must match the fixture's character
      class: 'Warrior',
      region: 'us',
      ruleset: 'normal',
    });
  expect(created.status).toBe(201);
  const charId = created.body.id as string;
  const imported = await testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: gearExport(), dryRun: false });
  expect(imported.status).toBe(200);
  return charId;
}

async function equipmentOf(charId: string): Promise<CharacterEquipmentDto> {
  const res = await testApp.request.get(`/characters/${charId}`);
  expect(res.status).toBe(200);
  return res.body.equipment as CharacterEquipmentDto;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Forever gear raw-link fallback (ROK-1760)', () => {
  it('shows the link name + quality, unresolved, until Wowhead resolves', async () => {
    const charId = await importLinkedGear();
    await waitFor(async () => {
      const rows = await testApp.db
        .select()
        .from(schema.wowItemMeta)
        .where(inArray(schema.wowItemMeta.itemId, [6120, 16921]));
      expect(rows.map((r) => r.status)).toEqual(['not_found', 'not_found']);
    }, 10_000);

    const before = await equipmentOf(charId);
    expect(before.items).toEqual([
      expect.objectContaining({
        slot: 'HEAD',
        itemId: 16921,
        name: 'Halo of Transcendence',
        quality: 'EPIC',
        resolved: false,
      }),
      expect.objectContaining({
        slot: 'SHIRT',
        itemId: 6120,
        name: "Recruit's Shirt",
        quality: 'COMMON',
        resolved: false,
      }),
    ]);

    await testApp.db
      .update(schema.wowItemMeta)
      .set({ status: 'resolved', env: 16, name: 'Wowhead Halo', quality: 3 })
      .where(eq(schema.wowItemMeta.itemId, 16921));
    const after = await equipmentOf(charId);
    expect(after.items[0]).toMatchObject({
      name: 'Wowhead Halo',
      quality: 'RARE',
      resolved: true,
    });
  });
});
