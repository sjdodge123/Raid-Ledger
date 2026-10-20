/**
 * ROK-1853 L3 — read queries behind the Materials routes. Every query is
 * scoped to one scan (D4) and passes through the D5 privacy fragments; the
 * selected columns never include a row id or `creatorPlayerId`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { findLatestContainerScan } from '../valheim-containers.repository';
import type { ArmoryCatalogReadRow } from './valheim-armory-catalog.helpers';
import { atlasReady, itemsSubset } from './valheim-armory-read.repository';
import type {
  MaterialsContainerRow,
  MaterialsTotalRow,
} from './valheim-materials.mappers';

type Db = PostgresJsDatabase<typeof schema>;
const c = schema.valheimContainers;
const st = schema.valheimContainerStacks;
const cat = schema.valheimItemCatalogs;

/** A visibility fragment (shared, personal or both) + the vehicle term. */
export type ContainerScope = SQL;

/** Counts over one scope's containers (warnings, chest count). */
export interface MaterialsCountsRow {
  chestCount: number;
  unreadable: number;
  omittedEntries: number;
}

/** One container (internal `id` kept for the stacks query) + its stacks. */
export interface MaterialsContainerDetailRow {
  summary: MaterialsContainerRow;
  stacks: Array<{ prefab: string; quality: number; stack: number }>;
}

/** A catalogue row plus whether it is the scan's own game version (D8). */
export type MaterialsCatalogRow = ArmoryCatalogReadRow & { exact: boolean };

const stackCount = sql<number>`(SELECT count(*)::int FROM ${st} s
  WHERE s.container_id = ${c.id})`;

const summaryCols = {
  key: c.publicKey,
  prefab: c.prefab,
  x: c.x,
  y: c.y,
  z: c.z,
  privacy: c.privacy,
  vehicle: c.vehicle,
  slots: c.slots,
  usedSlots: c.usedSlots,
  unreadable: c.unreadable,
  omittedEntries: c.omittedEntries,
  stackCount,
};

@Injectable()
export class ValheimMaterialsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** D4: the server's newest scan, or null before the first import. */
  latestScan(serverId: number): Promise<schema.ValheimContainerScan | null> {
    return findLatestContainerScan(this.db, serverId);
  }

  /** SUM(stack) per (prefab, quality) over the scope's containers. */
  totals(scanId: number, scope: ContainerScope): Promise<MaterialsTotalRow[]> {
    return this.db
      .select({
        prefab: st.prefab,
        quality: st.quality,
        total: sql<string>`sum(${st.stack})::bigint`,
        chests: sql<string>`count(DISTINCT ${st.containerId})`,
      })
      .from(st)
      .innerJoin(c, eq(c.id, st.containerId))
      .where(and(eq(c.scanId, scanId), scope))
      .groupBy(st.prefab, st.quality)
      .orderBy(asc(st.prefab), asc(st.quality));
  }

  /** Chest count + unreadable/omitted warnings over the scope. */
  async counts(
    scanId: number,
    scope: ContainerScope,
  ): Promise<MaterialsCountsRow> {
    const [row] = await this.db
      .select({
        chestCount: sql<number>`count(*)::int`,
        unreadable: sql<number>`count(*) FILTER (WHERE ${c.unreadable})::int`,
        omittedEntries: sql<number>`coalesce(sum(${c.omittedEntries}), 0)::int`,
      })
      .from(c)
      .where(and(eq(c.scanId, scanId), scope));
    return row ?? { chestCount: 0, unreadable: 0, omittedEntries: 0 };
  }

  /** The scope's containers, sorted `prefab, x, z, y` (then key). */
  listContainers(
    scanId: number,
    scope: ContainerScope,
  ): Promise<MaterialsContainerRow[]> {
    return this.db
      .select(summaryCols)
      .from(c)
      .where(and(eq(c.scanId, scanId), scope))
      .orderBy(asc(c.prefab), asc(c.x), asc(c.z), asc(c.y), asc(c.publicKey));
  }

  /** One container by public key within the scope, with its stacks. */
  async findContainer(scanId: number, key: string, scope: ContainerScope) {
    const [row] = await this.db
      .select({ ...summaryCols, id: c.id })
      .from(c)
      .where(and(eq(c.scanId, scanId), eq(c.publicKey, key), scope))
      .limit(1);
    if (!row) return null;
    const stacks = await this.db
      .select({ prefab: st.prefab, quality: st.quality, stack: st.stack })
      .from(st)
      .where(eq(st.containerId, row.id))
      .orderBy(asc(st.prefab), asc(st.quality));
    // `toContainerSummary` copies named fields only: `id` never leaves.
    return { summary: row, stacks };
  }

  /**
   * D8: the scan's game-version catalogue, else the server's newest one
   * (`exact: false`); only the referenced prefabs leave the database.
   */
  async findCatalog(
    serverId: number,
    gameVersion: string,
    prefabs: readonly string[],
  ): Promise<MaterialsCatalogRow | null> {
    const exact = sql<boolean>`${cat.gameVersion} = ${gameVersion}`;
    const [row] = await this.db
      .select({
        items: itemsSubset(prefabs),
        atlasSha256: cat.atlasSha256,
        atlasWidth: cat.atlasWidth,
        atlasHeight: cat.atlasHeight,
        atlasReady,
        exact,
      })
      .from(cat)
      .where(eq(cat.pelicanServerId, serverId))
      .orderBy(desc(exact), desc(cat.capturedAt), desc(cat.id))
      .limit(1);
    return row ?? null;
  }
}
