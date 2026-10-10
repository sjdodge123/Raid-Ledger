/**
 * ROK-1742 — LedgerLink v1 Forever fields against a real database, driven by
 * the golden `char-forever-quests` fixture through the real route: snapshot
 * schema 2 (quests at the 10 000 cap, in-progress objectives, enchant/gems),
 * `who.race` + `who.gender` persisted on the character row (R9), the
 * over-cap fixture rejected, and a legacy schema-1 row left readable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import {
  AddonCharSnapshotDataSchema,
  type AddonCharExport,
  type AddonCharSnapshotData,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { buildImportString } from './testing/addon-fixture.builder';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const fixtureText = (name: string): string =>
  readFileSync(join(FIXTURES, `${name}.txt`), 'utf8');
/**
 * The WIRE payload inside `char-forever-quests.txt`. Not the sibling `.json`
 * `payload`: that is the server-normalised shape (gear `link` already parsed
 * to `bonusIds`/`enchantId`/`gemIds`), which the strict wire schema rejects
 * with 422 INVALID_PAYLOAD when re-posted as an export.
 */
const questsPayload = (): AddonCharExport => {
  const body = fixtureText('char-forever-quests').trim().split('!').pop();
  return JSON.parse(
    inflateSync(Buffer.from(body ?? '', 'base64')).toString('utf8'),
  ) as AddonCharExport;
};

let testApp: TestApp;
let gameId: number;

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

/** A member with no characters; returns their token. */
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

/** A member + their token + a matching Forever character (no race/gender). */
async function memberWithChar(username: string) {
  const token = await member(username);
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
  return { token, charId: res.body.id as string };
}

const apply = (token: string, charId: string, s: string) =>
  testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: s, dryRun: false });

async function snapshotRow(charId: string) {
  const t = schema.characterAddonSnapshots;
  const [row] = await testApp.db
    .select()
    .from(t)
    .where(and(eq(t.characterId, charId), eq(t.section, 'char')));
  return nonEmpty(
    [row].filter((r) => r !== undefined),
    'snapshot',
  )[0];
}

async function characterRow(charId: string) {
  const [row] = await testApp.db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, charId));
  return nonEmpty(
    [row].filter((r) => r !== undefined),
    'character',
  )[0];
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('addon import — Forever fields (ROK-1742)', () => {
  it('stores snapshot schema 2 with quests at the cap + enchant/gems', async () => {
    const { token, charId } = await memberWithChar('anaquests');
    const res = await apply(token, charId, fixtureText('char-forever-quests'));
    expect(res.status).toBe(200);
    const row = await snapshotRow(charId);
    expect(row.schema).toBe(2);
    const data = AddonCharSnapshotDataSchema.parse(row.data);
    expect(data.quests?.completed).toHaveLength(10_000);
    expect(data.quests?.inProgress?.[0]?.objectives?.length).toBeGreaterThan(0);
    const bySlot = new Map(data.gear.map((g) => [g.slot, g]));
    expect(bySlot.get(5)).toMatchObject({ enchantId: 1900, gemIds: [2000] });
    expect(bySlot.get(4)).toMatchObject({ gemIds: [3000, 3001] });
  });

  it('persists who.race + who.gender on the character row (R9)', async () => {
    const { token, charId } = await memberWithChar('anarace');
    const before = await characterRow(charId);
    expect({ race: before.race, gender: before.gender }).toEqual({
      race: null,
      gender: null,
    });
    await apply(token, charId, fixtureText('char-forever-quests'));
    const after = await characterRow(charId);
    expect({ race: after.race, gender: after.gender }).toEqual({
      race: 'Night Elf',
      gender: 'female',
    });
    expect(after.lastSyncedAt).toEqual(before.lastSyncedAt);
  });

  it('create-from-export writes the display race + gender on the new row', async () => {
    const token = await member('anacreaterace');
    const res = await testApp.request
      .post('/plugins/wow/characters/addon-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importString: fixtureText('char-forever-quests'),
        dryRun: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.target.action).toBe('create');
    const created = await characterRow(res.body.target.characterId as string);
    expect({ race: created.race, gender: created.gender }).toEqual({
      race: 'Night Elf',
      gender: 'female',
    });
  });
});

describe('addon import — Forever fields re-import (ROK-1742)', () => {
  it('a later export with no who.gender keeps the stored gender', async () => {
    const { token, charId } = await memberWithChar('anakeep');
    const first = await apply(
      token,
      charId,
      fixtureText('char-forever-quests'),
    );
    expect(first.status).toBe(200);
    const next = questsPayload();
    expect(next.who.gender).toBe('female');
    delete next.who.gender;
    next.exportedAt += 3600;
    const res = await apply(token, charId, buildImportString(next));
    expect(res.body.code).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    expect((await characterRow(charId)).gender).toBe('female');
  });
});

describe('addon import — Forever fields guards (ROK-1742)', () => {
  it('quests.completed over the cap → 422 INVALID_PAYLOAD', async () => {
    const { token, charId } = await memberWithChar('anaovercap');
    const paste = readFileSync(
      join(FIXTURES, 'invalid/quests-completed-over-cap.txt'),
      'utf8',
    );
    const res = await apply(token, charId, paste);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PAYLOAD');
    const t = schema.characterAddonSnapshots;
    const rows = await testApp.db
      .select()
      .from(t)
      .where(eq(t.characterId, charId));
    expect(rows).toEqual([]);
  });

  it('a legacy schema-1 snapshot row still reads with its gear intact', async () => {
    const { charId } = await memberWithChar('anaschema1');
    const legacy: AddonCharSnapshotData = {
      gear: [
        { slot: 16, itemId: 19019, ilvl: 80, bonusIds: [] },
        { slot: 1, itemId: 16921, ilvl: 76, bonusIds: [] },
      ],
      talents: { configId: 7, nodes: [{ nodeId: 101, rank: 2 }] },
      lockouts: [],
    };
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId: charId,
      section: 'char',
      schema: 1,
      data: legacy,
      capturedAt: new Date('2026-09-01T00:00:00Z'),
      importedAt: new Date('2026-09-01T00:00:00Z'),
      payloadSha256: 'a'.repeat(64),
    });
    const row = await snapshotRow(charId);
    expect(row.schema).toBe(1);
    const data = AddonCharSnapshotDataSchema.parse(row.data);
    expect(data.gear).toEqual(legacy.gear);
    expect(data.gear.map((g) => Object.keys(g).sort())).toEqual(
      legacy.gear.map((g) => Object.keys(g).sort()),
    );
  });
});
