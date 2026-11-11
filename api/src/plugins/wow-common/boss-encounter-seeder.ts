import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { join } from 'path';

import * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  PRUNED_EXPANSION,
  findStaleClassicBossIds,
  findStaleClassicLootIds,
  pruneClassicRows,
  type BossKeyRow,
  type LootKeyRow,
  type LootWantedKey,
} from './boss-encounter-prune.helpers';

const BATCH_SIZE = 100;

interface BossEntry {
  instanceId: number;
  name: string;
  order: number;
  expansion: string;
  sodModified: boolean;
}

/**
 * Boss FK for a loot entry. ROK-2170: a `forever` loot row hangs off a
 * `forever` boss row when one exists, else off the classic boss of the same
 * name — boss rows are not duplicated for Forever.
 */
function resolveLootBossId(
  lookup: Map<string, number>,
  l: { bossName: string; expansion: string },
): number | undefined {
  const own = lookup.get(`${l.bossName}::${l.expansion}`);
  if (own !== undefined || l.expansion !== 'forever') return own;
  return lookup.get(`${l.bossName}::classic`);
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
   *
   * ROK-2142: after the upsert, classic boss rows and classic loot rows no
   * longer in the JSON are deleted in one transaction — see
   * `boss-encounter-prune.helpers.ts` (scope + truncated-file floor).
   */
  async seed(): Promise<{ bossesInserted: number; lootInserted: number }> {
    const bossPath = join(__dirname, 'data', 'boss-encounter-data.json');
    const bosses = JSON.parse(await readFile(bossPath, 'utf-8')) as BossEntry[];
    const bossesInserted = await this.seedBossEncounters(bosses);
    const rows: BossKeyRow[] = await this.db.select().from(wowClassicBosses);
    const warn = (m: string): void => this.logger.warn(m);
    const staleBossIds = findStaleClassicBossIds(rows, bosses, warn);
    const stale = new Set(staleBossIds);
    const live = rows.filter((r) => !stale.has(r.id));
    const loot = await this.seedLootItems(this.buildBossLookup(live));
    const classicBossIds = new Set(
      live.filter((r) => r.expansion === PRUNED_EXPANSION).map((r) => r.id),
    );
    const lootRows: LootKeyRow[] = await this.db
      .select()
      .from(wowClassicBossLoot);
    const staleLootIds = findStaleClassicLootIds(
      lootRows,
      loot.wanted,
      classicBossIds,
      warn,
    );
    await pruneClassicRows(this.db, staleBossIds, staleLootIds);
    this.logPrune(staleBossIds.length, staleLootIds.length);
    return { bossesInserted, lootInserted: loot.inserted };
  }

  /** Log what the stale-row prune removed (silent when nothing). */
  private logPrune(bosses: number, loot: number): void {
    if (bosses + loot === 0) return;
    this.logger.log(
      `Pruned ${bosses} stale classic boss encounters and ${loot} stale classic loot rows`,
    );
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
  private async seedBossEncounters(bosses: BossEntry[]): Promise<number> {
    this.logger.log(`Seeding ${bosses.length} boss encounters...`);
    let inserted = 0;
    for (let i = 0; i < bosses.length; i += BATCH_SIZE) {
      inserted += await this.upsertBossBatch(bosses.slice(i, i + BATCH_SIZE));
    }
    this.logger.log(`Seeded ${inserted}/${bosses.length} boss encounters`);
    return inserted;
  }

  /**
   * Seed loot items from bundled JSON data. Returns the upsert count and the
   * (bossId, itemId) keys the JSON wants, for the stale-loot prune.
   */
  private async seedLootItems(
    bossLookup: Map<string, number>,
  ): Promise<{ inserted: number; wanted: LootWantedKey[] }> {
    const lootPath = join(__dirname, 'data', 'boss-loot-data.json');
    const lootEntries = JSON.parse(
      await readFile(lootPath, 'utf-8'),
    ) as LootEntry[];
    this.logger.log(`Seeding ${lootEntries.length} loot items...`);
    const lootToInsert = this.mapLootEntries(lootEntries, bossLookup);
    let inserted = 0;
    for (let i = 0; i < lootToInsert.length; i += BATCH_SIZE) {
      const result = await this.upsertLootBatch(
        lootToInsert.slice(i, i + BATCH_SIZE),
      );
      inserted += result;
    }
    this.logger.log(`Seeded ${inserted}/${lootEntries.length} loot items`);
    return { inserted, wanted: lootToInsert };
  }

  /** Build boss name+expansion → DB id lookup map. */
  private buildBossLookup(allBosses: BossKeyRow[]): Map<string, number> {
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
        const bossId = resolveLootBossId(bossLookup, l);
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
