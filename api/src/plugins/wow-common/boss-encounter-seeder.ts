import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { join } from 'path';

import * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

interface BossEntry {
  instanceId: number;
  name: string;
  order: number;
  expansion: string;
  sodModified: boolean;
}

interface LootEntry {
  bossName: string;
  expansion: string;
  itemId: number;
  itemName: string;
  slot: string | null;
  quality: string;
  itemLevel: number | null;
  dropRate: number | null;
  classRestrictions: string[] | null;
  iconUrl: string | null;
}

/**
 * Seeds the wow_classic_bosses and wow_classic_boss_loot tables from bundled JSON.
 * Called on plugin install; data dropped on plugin uninstall.
 *
 * ROK-244: Variant-Aware Boss & Loot Table Seed Data
 */
@Injectable()
export class BossEncounterSeeder {
  private readonly logger = new Logger(BossEncounterSeeder.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Seed all boss encounters and loot from bundled data files.
   * Uses upsert (ON CONFLICT DO UPDATE) so data corrections propagate on re-seed.
   *
   * ROK-454: Changed from onConflictDoNothing to onConflictDoUpdate so that
   * quality, drop rate, item level, icon URL, and other corrections in the JSON
   * files are applied to existing rows on restart.
   */
  async seed(): Promise<{ bossesInserted: number; lootInserted: number }> {
    // --- Phase 1: Seed bosses ---
    const bossPath = join(__dirname, 'data', 'boss-encounter-data.json');
    const bossRaw = await readFile(bossPath, 'utf-8');
    const bosses = JSON.parse(bossRaw) as BossEntry[];

    this.logger.log(`Seeding ${bosses.length} boss encounters...`);

    const BATCH_SIZE = 100;
    let bossesInserted = 0;

    for (let i = 0; i < bosses.length; i += BATCH_SIZE) {
      const batch = bosses.slice(i, i + BATCH_SIZE);
      const result = await this.db
        .insert(wowClassicBosses)
        .values(
          batch.map((b) => ({
            instanceId: b.instanceId,
            name: b.name,
            order: b.order,
            expansion: b.expansion,
            sodModified: b.sodModified,
          })),
        )
        .onConflictDoUpdate({
          target: [
            wowClassicBosses.instanceId,
            wowClassicBosses.name,
            wowClassicBosses.expansion,
          ],
          set: {
            order: sql`excluded.order`,
            sodModified: sql`excluded.sod_modified`,
          },
        })
        .returning({ id: wowClassicBosses.id });

      bossesInserted += result.length;
    }

    this.logger.log(
      `Seeded ${bossesInserted}/${bosses.length} boss encounters`,
    );

    // --- Phase 2: Seed loot (resolve boss FKs by name+expansion) ---
    const lootPath = join(__dirname, 'data', 'boss-loot-data.json');
    const lootRaw = await readFile(lootPath, 'utf-8');
    const lootEntries = JSON.parse(lootRaw) as LootEntry[];

    this.logger.log(`Seeding ${lootEntries.length} loot items...`);

    // Build a lookup map of boss name+expansion → DB id
    const allBosses = await this.db.select().from(wowClassicBosses);
    const bossLookup = new Map<string, number>();
    for (const b of allBosses) {
      bossLookup.set(`${b.name}::${b.expansion}`, b.id);
    }

    let lootInserted = 0;
    const lootToInsert = lootEntries
      .map((l) => {
        const bossId = bossLookup.get(`${l.bossName}::${l.expansion}`);
        if (!bossId) {
          this.logger.warn(
            `Skipping loot "${l.itemName}" — boss "${l.bossName}" (${l.expansion}) not found`,
          );
          return null;
        }
        return {
          bossId,
          itemId: l.itemId,
          itemName: l.itemName,
          slot: l.slot,
          quality: l.quality,
          itemLevel: l.itemLevel,
          dropRate: l.dropRate?.toString() ?? null,
          expansion: l.expansion,
          classRestrictions: l.classRestrictions,
          iconUrl: l.iconUrl,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    for (let i = 0; i < lootToInsert.length; i += BATCH_SIZE) {
      const batch = lootToInsert.slice(i, i + BATCH_SIZE);
      const result = await this.db
        .insert(wowClassicBossLoot)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            wowClassicBossLoot.bossId,
            wowClassicBossLoot.itemId,
            wowClassicBossLoot.expansion,
          ],
          set: {
            itemName: sql`excluded.item_name`,
            slot: sql`excluded.slot`,
            quality: sql`excluded.quality`,
            itemLevel: sql`excluded.item_level`,
            dropRate: sql`excluded.drop_rate`,
            classRestrictions: sql`excluded.class_restrictions`,
            iconUrl: sql`excluded.icon_url`,
          },
        })
        .returning({ id: wowClassicBossLoot.id });

      lootInserted += result.length;
    }

    this.logger.log(`Seeded ${lootInserted}/${lootEntries.length} loot items`);

    return { bossesInserted, lootInserted };
  }

  /**
   * Remove all boss encounter and loot data (called on plugin uninstall).
   * Loot deleted first to respect FK ordering.
   */
  async drop(): Promise<void> {
    await this.db.delete(wowClassicBossLoot);
    await this.db.delete(wowClassicBosses);
    this.logger.log('Dropped all boss encounter and loot data');
  }
}
