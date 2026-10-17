import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { join } from 'path';

import * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

const BATCH_SIZE = 100;

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
  itemSubclass: string | null;
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
    const bossesInserted = await this.seedBossEncounters();
    const lootInserted = await this.seedLootItems();
    return { bossesInserted, lootInserted };
  }

  /** Upsert a batch of boss encounters. */
  private async upsertBossBatch(batch: BossEntry[]): Promise<number> {
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
    return result.length;
  }

  /** Seed boss encounters from bundled JSON data. */
  private async seedBossEncounters(): Promise<number> {
    const bossPath = join(__dirname, 'data', 'boss-encounter-data.json');
    const bosses = JSON.parse(await readFile(bossPath, 'utf-8')) as BossEntry[];
    this.logger.log(`Seeding ${bosses.length} boss encounters...`);
    let inserted = 0;
    for (let i = 0; i < bosses.length; i += BATCH_SIZE) {
      inserted += await this.upsertBossBatch(bosses.slice(i, i + BATCH_SIZE));
    }
    this.logger.log(`Seeded ${inserted}/${bosses.length} boss encounters`);
    return inserted;
  }

  /** Seed loot items from bundled JSON data. */
  private async seedLootItems(): Promise<number> {
    const lootPath = join(__dirname, 'data', 'boss-loot-data.json');
    const lootEntries = JSON.parse(
      await readFile(lootPath, 'utf-8'),
    ) as LootEntry[];
    this.logger.log(`Seeding ${lootEntries.length} loot items...`);
    const bossLookup = await this.buildBossLookup();
    const lootToInsert = this.mapLootEntries(lootEntries, bossLookup);
    let inserted = 0;
    for (let i = 0; i < lootToInsert.length; i += BATCH_SIZE) {
      const result = await this.upsertLootBatch(
        lootToInsert.slice(i, i + BATCH_SIZE),
      );
      inserted += result;
    }
    this.logger.log(`Seeded ${inserted}/${lootEntries.length} loot items`);
    return inserted;
  }

  /** Build boss name+expansion → DB id lookup map. */
  private async buildBossLookup(): Promise<Map<string, number>> {
    const allBosses = await this.db.select().from(wowClassicBosses);
    const lookup = new Map<string, number>();
    for (const b of allBosses) lookup.set(`${b.name}::${b.expansion}`, b.id);
    return lookup;
  }

  /** Map loot entries to insert values, resolving boss FKs. */
  private mapLootEntries(
    entries: LootEntry[],
    bossLookup: Map<string, number>,
  ) {
    return entries
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
          itemSubclass: l.itemSubclass,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }

  /** Upsert a batch of loot items. */
  private async upsertLootBatch(
    batch: Array<Record<string, unknown>>,
  ): Promise<number> {
    const result = await this.db
      .insert(wowClassicBossLoot)
      .values(batch as never)
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
          itemSubclass: sql`excluded.item_subclass`,
        },
      })
      .returning({ id: wowClassicBossLoot.id });
    return result.length;
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
