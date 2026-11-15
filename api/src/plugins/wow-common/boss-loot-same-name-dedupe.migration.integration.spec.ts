/**
 * ROK-2197 migration 0300 — real database.
 *
 * Before ROK-2193 the seeder upserted the bundled loot of a shared boss name
 * under BOTH same-name boss rows of one expansion (Kael'thas Sunstrider tbc
 * 249/749, Anub'arak wotlk 272/757). Seeds the bundle with the real seeder,
 * recreates that OLD shape (every bundled row copied onto the other boss),
 * runs the migration SQL and checks each boss keeps exactly its bundled rows,
 * an unrelated row on the same boss survives, a re-run deletes nothing and a
 * re-seed does not regrow the copies.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { defined } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { BossEncounterSeeder } from './boss-encounter-seeder';

const MIGRATION = '0300_dedupe_same_name_boss_loot.sql';
const KAEL = "Kael'thas Sunstrider";
const ANUB = "Anub'arak";
const CONTROL_ITEM = 999_201;

interface BossRef {
  name: string;
  expansion: string;
  instanceId: number;
}

const BOSSES: readonly BossRef[] = [
  { name: KAEL, expansion: 'tbc', instanceId: 249 },
  { name: KAEL, expansion: 'tbc', instanceId: 749 },
  { name: ANUB, expansion: 'wotlk', instanceId: 272 },
  { name: ANUB, expansion: 'wotlk', instanceId: 757 },
];

interface BundledLoot {
  bossName: string;
  expansion: string;
  instanceId?: number;
}

const bundled = JSON.parse(
  readFileSync(join(__dirname, 'data', 'boss-loot-data.json'), 'utf-8'),
) as BundledLoot[];

/** Bundled loot rows the seeder writes under one boss row. */
const bundledOn = (b: BossRef): number =>
  bundled.filter(
    (l) =>
      l.bossName === b.name &&
      l.expansion === b.expansion &&
      l.instanceId === b.instanceId,
  ).length;

/** Bundled loot rows of the shared name (both instances together). */
const bundledForName = (b: BossRef): number =>
  bundled.filter((l) => l.bossName === b.name && l.expansion === b.expansion)
    .length;

let testApp: TestApp;

async function bossId(b: BossRef): Promise<number> {
  const t = schema.wowClassicBosses;
  const rows = await testApp.db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.name, b.name),
        eq(t.expansion, b.expansion),
        eq(t.instanceId, b.instanceId),
      ),
    );
  expect(rows).toHaveLength(1);
  return defined(rows[0], `${b.name} ${b.instanceId} boss row`).id;
}

async function lootOn(b: BossRef): Promise<number> {
  const t = schema.wowClassicBossLoot;
  const id = await bossId(b);
  const rows = await testApp.db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.bossId, id), eq(t.expansion, b.expansion)));
  return rows.length;
}

async function lootOfExpansion(expansion: string): Promise<number> {
  const t = schema.wowClassicBossLoot;
  const rows = await testApp.db
    .select({ id: t.id })
    .from(t)
    .where(eq(t.expansion, expansion));
  return rows.length;
}

/** Recreate the pre-ROK-2193 shape: each row copied onto the other boss. */
async function injectOldDuplicates(): Promise<void> {
  await testApp.db.execute(sql`
    INSERT INTO "wow_classic_boss_loot"
      ("boss_id", "item_id", "item_name", "slot", "quality", "item_level",
       "drop_rate", "expansion", "class_restrictions", "icon_url",
       "item_subclass")
    SELECT o."id", l."item_id", l."item_name", l."slot", l."quality",
           l."item_level", l."drop_rate", l."expansion",
           l."class_restrictions", l."icon_url", l."item_subclass"
    FROM "wow_classic_boss_loot" l
    JOIN "wow_classic_bosses" b ON b."id" = l."boss_id"
    JOIN "wow_classic_bosses" o
      ON o."name" = b."name" AND o."expansion" = b."expansion"
     AND o."id" <> b."id"
    WHERE b."name" IN (${KAEL}, ${ANUB}) AND l."expansion" = b."expansion"
    ON CONFLICT DO NOTHING`);
}

/** A loot row the bundle does not know, on a migrated boss: must survive. */
async function insertControlRow(b: BossRef): Promise<void> {
  await testApp.db.insert(schema.wowClassicBossLoot).values({
    bossId: await bossId(b),
    itemId: CONTROL_ITEM,
    itemName: 'ROK-2197 control item',
    quality: 'Epic',
    expansion: b.expansion,
  });
}

async function runMigration(): Promise<void> {
  const file = join(__dirname, '../../drizzle/migrations', MIGRATION);
  const statements = readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await testApp.db.execute(sql.raw(statement));
  }
}

/** Every same-name boss holds exactly its bundled rows (+ control on one). */
async function expectBundledSplit(control: BossRef): Promise<void> {
  for (const b of BOSSES) {
    const extra = b === control ? 1 : 0;
    expect({ boss: `${b.name} ${b.instanceId}`, n: await lootOn(b) }).toEqual({
      boss: `${b.name} ${b.instanceId}`,
      n: bundledOn(b) + extra,
    });
  }
}

describe('ROK-2197 migration 0300: same-name boss loot dedupe', () => {
  const control = defined(BOSSES[1], 'The Eye Kael boss ref');
  let tbcSeeded = 0;
  let wotlkSeeded = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  // Every test starts from a fresh seed + the recreated old shape, so the
  // suite holds under `--randomize`; each test runs the migration itself.
  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    const seeder = testApp.app.get(BossEncounterSeeder, { strict: false });
    await seeder.seed();
    tbcSeeded = await lootOfExpansion('tbc');
    wotlkSeeded = await lootOfExpansion('wotlk');
    await injectOldDuplicates();
    await insertControlRow(control);
  });

  it('starts from the old shape: every shared-name row on both bosses', async () => {
    for (const b of BOSSES) {
      expect(bundledOn(b)).toBeGreaterThan(0);
      expect(await lootOn(b)).toBe(bundledForName(b) + (b === control ? 1 : 0));
    }
  });

  it('leaves each boss exactly its bundled loot and keeps unrelated rows', async () => {
    await runMigration();
    await expectBundledSplit(control);
    expect(await lootOfExpansion('tbc')).toBe(tbcSeeded + 1);
    expect(await lootOfExpansion('wotlk')).toBe(wotlkSeeded);
  });

  it('a re-run deletes nothing', async () => {
    await runMigration();
    await runMigration();
    await expectBundledSplit(control);
    expect(await lootOfExpansion('tbc')).toBe(tbcSeeded + 1);
  });

  it('a re-seed after the migration does not regrow the copies', async () => {
    await runMigration();
    const seeder = testApp.app.get(BossEncounterSeeder, { strict: false });
    await seeder.seed();
    await expectBundledSplit(control);
    expect(await lootOfExpansion('wotlk')).toBe(wotlkSeeded);
  });
});
