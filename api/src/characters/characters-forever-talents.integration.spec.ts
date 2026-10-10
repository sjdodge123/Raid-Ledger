/**
 * ROK-1744: WoW: Forever talents on the public character detail
 * (`GET /characters/:id`) against a real database. The LedgerLink `char`
 * snapshot's `talents.nodes[]` becomes a `format: 'forever'` DTO (grid when
 * every node carries posX/posY, list otherwise); stored Armory talents win
 * when newer (D4); other variants and empty node sets keep the stored value.
 */
import { eq } from 'drizzle-orm';
import type {
  AddonCharSnapshotData,
  ForeverTalentsDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { WowItemMetaService } from '../plugins/wow-common/wowhead-item/wow-item-meta.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const CLASSIC_SLUG = 'world-of-warcraft-classic';
const CAPTURED_AT = new Date('2026-09-15T12:00:00.000Z');
/** Warrior probe (tree 1117): sub-tree origins, 600 step, rows from 2130. */
const ORIGINS = [1020, 5020, 9080];
const TREE_SIZES = [16, 20, 16];

interface RawNode {
  nodeId: number;
  rank: number;
  maxRanks?: number;
  name?: string;
  spellId?: number;
  posX?: number;
  posY?: number;
  entryId?: number;
}

/**
 * 52 positioned nodes (16/20/16), cells filled row-major per sub-tree.
 * Ranks: tree 0 = first 10 nodes × 3 + one × 1 (31); tree 1 = 10 × 2 (20);
 * tree 2 = all 0.
 */
function warriorNodes(): RawNode[] {
  const nodes: RawNode[] = [];
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

/** v1.1.2 addon shape: ranked nodes only, no positions. */
const RANKED_ONLY: RawNode[] = [
  { nodeId: 101, rank: 2, entryId: 9001 },
  { nodeId: 102, rank: 5, entryId: 9002 },
];

const STORED_CLASSIC_TALENTS = {
  format: 'classic',
  trees: [{ name: 'Arms', spentPoints: 31, talents: [] }],
  summary: '31/20/0',
};

function snapshotData(nodes: RawNode[]): AddonCharSnapshotData {
  return {
    gear: [{ slot: 1, itemId: 16921, ilvl: 76, bonusIds: [] }],
    talents: { configId: 7, nodes },
    lockouts: [],
  };
}

async function ensureGame(testApp: TestApp, slug: string): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug })
      .returning(),
    slug,
  );
  return game.id;
}

async function activateBlizzard(testApp: TestApp): Promise<void> {
  const registry = testApp.app.get(PluginRegistryService);
  const manifest = registry.getManifest('blizzard');
  await testApp.db
    .insert(schema.plugins)
    .values({
      slug: 'blizzard',
      name: manifest?.name ?? 'blizzard',
      version: manifest?.version ?? '0.0.0',
      active: true,
    })
    .onConflictDoUpdate({
      target: schema.plugins.slug,
      set: { active: true, updatedAt: new Date() },
    });
  await registry.onModuleInit();
}

describe('Forever addon talents on GET /characters/:id (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    await activateBlizzard(testApp);
    const meta = testApp.app.get(WowItemMetaService);
    jest.spyOn(meta, 'enqueue').mockResolvedValue(0);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedCharacter(opts: {
    slug?: string;
    gameVariant?: string | null;
    talents?: unknown;
    lastSyncedAt?: Date | null;
  }): Promise<string> {
    const gameId = await ensureGame(testApp, opts.slug ?? FOREVER_SLUG);
    const [row] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId,
          name: 'Brak Forever',
          region: 'us',
          class: 'Warrior',
          gameVariant: opts.gameVariant ?? null,
          talents: opts.talents ?? null,
          lastSyncedAt: opts.lastSyncedAt ?? null,
        })
        .returning(),
      'character',
    );
    return row.id;
  }

  async function seedSnapshot(id: string, nodes: RawNode[]): Promise<void> {
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId: id,
      section: 'char',
      schema: 2,
      data: snapshotData(nodes),
      capturedAt: CAPTURED_AT,
      payloadSha256: 'b'.repeat(64),
    });
  }

  const get = (id: string) => testApp.request.get(`/characters/${id}`);

  it('positioned Warrior nodes render as a 3-tree grid without raw positions', async () => {
    const id = await seedCharacter({});
    await seedSnapshot(id, warriorNodes());

    const res = await get(id);

    expect(res.status).toBe(200);
    const talents = res.body.talents as ForeverTalentsDto;
    expect(talents).toMatchObject({
      format: 'forever',
      source: 'addon',
      layout: 'grid',
      syncedAt: CAPTURED_AT.toISOString(),
      configId: 7,
    });
    expect(talents.trees).toEqual([
      { index: 0, spent: 31 },
      { index: 1, spent: 20 },
      { index: 2, spent: 0 },
    ]);
    expect(talents.nodes).toHaveLength(52);
    for (const node of talents.nodes) {
      expect(node).toEqual(
        expect.objectContaining({
          tree: expect.any(Number),
          row: expect.any(Number),
          col: expect.any(Number),
        }),
      );
      expect(node).not.toHaveProperty('posX');
      expect(node).not.toHaveProperty('posY');
      expect(node).not.toHaveProperty('entryId');
    }
    const third = talents.nodes.find((n) => n.nodeId === 1000 + 36 + 7);
    expect(third).toMatchObject({ tree: 2, row: 1, col: 3 });
    const [stored] = await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(stored?.talents).toBeNull();
    expect(stored?.lastSyncedAt).toBeNull();
  });

  it('ranked-only nodes without positions render as a list with no trees', async () => {
    const id = await seedCharacter({});
    await seedSnapshot(id, RANKED_ONLY);

    const res = await get(id);

    expect(res.body.talents).toMatchObject({
      format: 'forever',
      layout: 'list',
      trees: [],
    });
    expect(res.body.talents.nodes).toEqual([
      { nodeId: 101, rank: 2 },
      { nodeId: 102, rank: 5 },
    ]);
  });

  it('D4: stored talents synced after the capture are returned untouched', async () => {
    const id = await seedCharacter({
      gameVariant: 'wow_forever',
      talents: STORED_CLASSIC_TALENTS,
      lastSyncedAt: new Date('2026-09-20T00:00:00.000Z'),
    });
    await seedSnapshot(id, warriorNodes());

    expect((await get(id)).body.talents).toEqual(STORED_CLASSIC_TALENTS);
  });

  it('D4: stored talents synced before the capture lose to the addon DTO', async () => {
    const id = await seedCharacter({
      gameVariant: 'wow_forever',
      talents: STORED_CLASSIC_TALENTS,
      lastSyncedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await seedSnapshot(id, warriorNodes());

    const res = await get(id);

    expect(res.body.talents).toMatchObject({
      format: 'forever',
      layout: 'grid',
    });
  });

  it('a Classic character keeps its stored talents even with a snapshot row', async () => {
    const id = await seedCharacter({
      slug: CLASSIC_SLUG,
      gameVariant: 'classic_era',
      talents: STORED_CLASSIC_TALENTS,
    });
    await seedSnapshot(id, warriorNodes());

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(res.body.talents).toEqual(STORED_CLASSIC_TALENTS);
  });

  it('an empty node set keeps the stored talents', async () => {
    const id = await seedCharacter({ talents: STORED_CLASSIC_TALENTS });
    await seedSnapshot(id, []);

    expect((await get(id)).body.talents).toEqual(STORED_CLASSIC_TALENTS);
  });

  it("a Forever character without a snapshot keeps today's null talents", async () => {
    const id = await seedCharacter({});

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(res.body.talents).toBeNull();
  });

  it('the same snapshot drives both the gear and the talents overrides', async () => {
    const id = await seedCharacter({});
    await seedSnapshot(id, warriorNodes());

    const res = await get(id);

    expect(res.body.equipment).toMatchObject({
      source: 'addon',
      syncedAt: CAPTURED_AT.toISOString(),
    });
    expect(res.body.equipment.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'HEAD', itemId: 16921 }),
      ]),
    );
    expect(res.body.talents).toMatchObject({
      format: 'forever',
      layout: 'grid',
    });
  });
});
