/**
 * ROK-1744 — the Forever talents grid end to end through the REAL addon import
 * route (closes Codex HIGH "import path rejects positions"): a schema-2 wire
 * export whose talent nodes carry name/spellId/maxRanks/posX/posY (ROK-1742)
 * is accepted, stored, and rendered by GET /characters/:id as a 3-tree grid.
 * Request shape + auth mirror `addon-import.forever-fields.integration.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type {
  AddonCharExport,
  AddonTalentNode,
  ForeverTalentsDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { WowItemMetaService } from '../plugins/wow-common/wowhead-item/wow-item-meta.service';
import { buildImportString } from '../plugins/wow-common/addon-import/testing/addon-fixture.builder';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURE = join(
  __dirname,
  '../../../packages/contract/ledgerlink/v1/fixtures/char-forever-quests.txt',
);
const ORIGINS = [1020, 5020, 9080];
const TREE_SIZES = [16, 20, 16];

/** The wire payload of the golden Forever fixture (not the normalised `.json`). */
function wirePayload(): AddonCharExport {
  const body = readFileSync(FIXTURE, 'utf8').trim().split('!').pop();
  return JSON.parse(
    inflateSync(Buffer.from(body ?? '', 'base64')).toString('utf8'),
  ) as AddonCharExport;
}

/** Warrior-shaped 16/20/16 nodes with display + raw position keys (31/20/0 spent). */
function warriorNodes(): AddonTalentNode[] {
  const nodes: AddonTalentNode[] = [];
  TREE_SIZES.forEach((size, tree) => {
    for (let j = 0; j < size; j++) {
      let rank = 0;
      if (tree === 0) rank = j < 10 ? 3 : j === 10 ? 1 : 0;
      if (tree === 1) rank = j < 10 ? 2 : 0;
      const id = nodes.length;
      nodes.push({
        nodeId: 1000 + id,
        rank,
        maxRanks: 3,
        name: `Talent ${tree}-${j}`,
        spellId: 20000 + id,
        posX: ORIGINS[tree]! + (j % 4) * 600,
        posY: 2130 + Math.floor(j / 4) * 600,
        entryId: 5000 + id,
      });
    }
  });
  return nodes;
}

/** The fixture export with its talents replaced by the positioned Warrior set. */
function talentsExport(): string {
  const payload = wirePayload() as AddonCharExport & {
    data: { talents: { configId?: number; nodes: AddonTalentNode[] } };
  };
  payload.data.talents = { configId: 7, nodes: warriorNodes() };
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

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  jest
    .spyOn(testApp.app.get(WowItemMetaService), 'enqueue')
    .mockResolvedValue(0);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Forever talents via the real addon import (ROK-1744)', () => {
  it('a positioned schema-2 export imports and renders as a 3-tree grid', async () => {
    const gameId = await ensureGame();
    const token = await member('brakimport');
    const created = await testApp.request
      .post('/users/me/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        gameId,
        name: 'Ana Forever',
        class: 'Warrior',
        region: 'us',
        ruleset: 'normal',
      });
    expect(created.status).toBe(201);
    const charId = created.body.id as string;

    const imported = await testApp.request
      .post(`/plugins/wow/characters/${charId}/addon-import`)
      .set('Authorization', `Bearer ${token}`)
      .send({ importString: talentsExport(), dryRun: false });
    expect(imported.status).toBe(200);

    const res = await testApp.request.get(`/characters/${charId}`);
    expect(res.status).toBe(200);
    const talents = res.body.talents as ForeverTalentsDto;
    expect(talents).toMatchObject({
      format: 'forever',
      layout: 'grid',
      configId: 7,
    });
    expect(talents.trees).toEqual([
      { index: 0, spent: 31 },
      { index: 1, spent: 20 },
      { index: 2, spent: 0 },
    ]);
    expect(talents.nodes).toHaveLength(52);
    const third = talents.nodes.find((n) => n.nodeId === 1000 + 36 + 7);
    expect(third).toMatchObject({
      tree: 2,
      row: 1,
      col: 3,
      name: 'Talent 2-7',
    });
    expect(third).not.toHaveProperty('posX');
  });
});
