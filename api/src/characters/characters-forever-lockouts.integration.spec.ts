/**
 * ROK-1743: WoW: Forever saved instances on the public character detail
 * (`GET /characters/:id`) against a real database. The LedgerLink `char`
 * snapshot's `lockouts[]` becomes `lockouts.instances` with expired entries
 * dropped; no live lockouts, or a non-Forever character, means no key.
 */
import { eq } from 'drizzle-orm';
import type {
  AddonCharSnapshotData,
  AddonLockout,
  CharacterLockoutsDto,
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
/** Relative to the wall clock — a fixed future timestamp would rot. */
const FUTURE_RESET_S = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
/** The LedgerLink fixture default, already in the past. */
const PAST_RESET_S = 1_790_500_000;

const MOLTEN_CORE: AddonLockout = {
  name: 'Molten Core',
  instanceId: 409,
  difficultyId: 9,
  resetAt: FUTURE_RESET_S,
  killed: 4,
  total: 10,
};
const EXPIRED_ONYXIA: AddonLockout = {
  name: "Onyxia's Lair",
  instanceId: 249,
  difficultyId: 9,
  resetAt: PAST_RESET_S,
  killed: 1,
  total: 1,
};

function snapshotData(lockouts: AddonLockout[]): AddonCharSnapshotData {
  return {
    gear: [{ slot: 1, itemId: 16921, ilvl: 76, bonusIds: [] }],
    talents: { configId: 7, nodes: [] },
    lockouts,
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

describe('Forever addon lockouts on GET /characters/:id (integration)', () => {
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

  async function seedCharacter(slug: string): Promise<string> {
    const gameId = await ensureGame(testApp, slug);
    const [row] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId,
          name: 'Brak Forever',
          region: 'us',
          class: 'Warrior',
        })
        .returning(),
      'character',
    );
    return row.id;
  }

  async function seedSnapshot(
    id: string,
    lockouts: AddonLockout[],
  ): Promise<void> {
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId: id,
      section: 'char',
      schema: 2,
      data: snapshotData(lockouts),
      capturedAt: CAPTURED_AT,
      payloadSha256: 'c'.repeat(64),
    });
  }

  const get = (id: string) => testApp.request.get(`/characters/${id}`);

  it('shows only the unexpired lockout, labelled 40 Player', async () => {
    const id = await seedCharacter(FOREVER_SLUG);
    await seedSnapshot(id, [EXPIRED_ONYXIA, MOLTEN_CORE]);

    const res = await get(id);

    expect(res.status).toBe(200);
    const lockouts = res.body.lockouts as CharacterLockoutsDto;
    expect(lockouts).toEqual({
      source: 'addon',
      syncedAt: CAPTURED_AT.toISOString(),
      instances: [
        {
          name: 'Molten Core',
          instanceId: 409,
          difficultyId: 9,
          difficulty: '40 Player',
          resetAt: new Date(FUTURE_RESET_S * 1000).toISOString(),
          killed: 4,
          total: 10,
        },
      ],
    });
  });

  it('a Forever character whose snapshot has no lockouts has no lockouts key', async () => {
    const id = await seedCharacter(FOREVER_SLUG);
    await seedSnapshot(id, []);

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).not.toContain('lockouts');
  });

  it('a non-Forever character has no lockouts key, even with a snapshot', async () => {
    const id = await seedCharacter(CLASSIC_SLUG);
    await seedSnapshot(id, [MOLTEN_CORE]);

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).not.toContain('lockouts');
  });
});
