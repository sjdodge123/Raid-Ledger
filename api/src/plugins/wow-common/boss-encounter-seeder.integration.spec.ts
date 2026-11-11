/**
 * Boss seeder stale-row prune — real database (ROK-2170 D7).
 *
 * Boots the real `BossEncounterSeeder.seed()` against Postgres and proves the
 * prune keeps every bundled `classic` and `forever` loot row, deletes stray
 * rows of both expansions (a Forever loot row hangs off the CLASSIC boss row),
 * and deletes nothing on a clean re-seed.
 *
 * Separate from `boss-encounters.integration.spec.ts` on purpose: that spec
 * inserts its own fixture bosses, which a real `seed()` would prune.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { and, eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { defined } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { BossEncounterSeeder } from './boss-encounter-seeder';

const REND = 'Warchief Rend Blackhand';
const STRAY_FOREVER_ITEM = 999001;
const STRAY_CLASSIC_ITEM = 999002;

interface BundledLoot {
  bossName: string;
  expansion: string;
}

const bundled = JSON.parse(
  readFileSync(join(__dirname, 'data', 'boss-loot-data.json'), 'utf-8'),
) as BundledLoot[];
const bundledCount = (expansion: string, bossName?: string): number =>
  bundled.filter(
    (l) =>
      l.expansion === expansion &&
      (bossName === undefined || l.bossName === bossName),
  ).length;

let testApp: TestApp;

/** Stored loot rows of one expansion, optionally on one boss. */
async function storedCount(expansion: string, bossId?: number) {
  const loot = schema.wowClassicBossLoot;
  const rows = await testApp.db
    .select({ id: loot.id })
    .from(loot)
    .where(
      bossId === undefined
        ? eq(loot.expansion, expansion)
        : and(eq(loot.expansion, expansion), eq(loot.bossId, bossId)),
    );
  return rows.length;
}

/** The single seeded classic boss row for Rend; fails loudly if absent. */
async function rendBossId(): Promise<number> {
  const b = schema.wowClassicBosses;
  const rows = await testApp.db
    .select({ id: b.id })
    .from(b)
    .where(and(eq(b.name, REND), eq(b.expansion, 'classic')));
  expect(rows).toHaveLength(1);
  return defined(rows[0], 'Rend classic boss row').id;
}

/** Totals a correctly pruned database must hold after `seed()`. */
async function expectBundledCounts(): Promise<void> {
  expect(await storedCount('forever')).toBe(bundledCount('forever'));
  expect(await storedCount('classic')).toBe(bundledCount('classic'));
}

/** Insert one stray loot row (an item not in the bundled JSON) on a boss. */
async function insertStray(bossId: number, itemId: number, expansion: string) {
  await testApp.db.insert(schema.wowClassicBossLoot).values({
    bossId,
    itemId,
    itemName: `Stray ${expansion} item`,
    quality: 'epic',
    expansion,
  });
}

/** Rows still stored for the two stray item ids. */
async function strayRows() {
  const loot = schema.wowClassicBossLoot;
  return testApp.db
    .select({ itemId: loot.itemId, expansion: loot.expansion })
    .from(loot)
    .where(inArray(loot.itemId, [STRAY_FOREVER_ITEM, STRAY_CLASSIC_ITEM]));
}

async function testStraysArePruned(seeder: BossEncounterSeeder) {
  await seeder.seed();
  const rendId = await rendBossId();
  await insertStray(rendId, STRAY_FOREVER_ITEM, 'forever');
  await insertStray(rendId, STRAY_CLASSIC_ITEM, 'classic');
  expect(await strayRows()).toHaveLength(2);
  await seeder.seed();
  expect(await strayRows()).toEqual([]);
  expect(await storedCount('forever', rendId)).toBe(
    bundledCount('forever', REND),
  );
  await expectBundledCounts();
}

describe('BossEncounterSeeder prune (integration)', () => {
  let seeder: BossEncounterSeeder;

  beforeAll(async () => {
    testApp = await getTestApp();
    testApp.seed = await truncateAllTables(testApp.db);
    seeder = testApp.app.get(BossEncounterSeeder, { strict: false });
  });

  it('keeps every bundled classic and forever loot row', async () => {
    expect(bundledCount('forever')).toBeGreaterThan(0);
    expect(bundledCount('forever', REND)).toBe(9);
    await seeder.seed();
    await expectBundledCounts();
  });

  it('prunes stray forever and classic loot on a classic boss', () =>
    testStraysArePruned(seeder));

  it('a clean re-seed deletes nothing', async () => {
    await seeder.seed();
    await expectBundledCounts();
    await seeder.seed();
    await expectBundledCounts();
  });
});
