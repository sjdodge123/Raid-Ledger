/**
 * ROK-1853 L3 — read queries behind the Materials routes. Every query is
 * scoped to one scan (D4) and passes through the D5 privacy fragments; the
 * selected columns never include a row id or `creatorPlayerId`. A request's
 * reads run in one read-only REPEATABLE READ transaction (`read`), so an
 * import committing mid-request cannot mix old and new totals (review M2).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';
import { findLatestContainerScan } from '../valheim-containers.repository';
import type { ArmoryCatalogReadRow } from './valheim-armory-catalog.helpers';
import { atlasReady, itemsSubset } from './valheim-armory-read.repository';
import {
  toCountsRow,
  type MaterialsContainerRow,
  type MaterialsCountsRow,
  type MaterialsTotalRow,
} from './valheim-materials.mappers';

type Db = PostgresJsDatabase<typeof schema>;
type Exec = Db | ValheimLinkTx;
const c = schema.valheimContainers;
const st = schema.valheimContainerStacks;
const cat = schema.valheimItemCatalogs;

/** A visibility fragment (shared, personal or both) + the vehicle term. */
export type ContainerScope = SQL;

export type { MaterialsCountsRow } from './valheim-materials.mappers';

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

/** One consistent snapshot: every statement sees the same committed state. */
export const MATERIALS_READ_TX = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const;

@Injectable()
export class ValheimMaterialsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Run `fn`'s reads in one read-only REPEATABLE READ transaction. */
  read<T>(fn: (reader: MaterialsReader) => Promise<T>): Promise<T> {
    return this.db.transaction(
      (tx) => fn(new MaterialsReader(tx)),
      MATERIALS_READ_TX,
    );
  }
}

/** The Materials queries, bound to one executor (the read transaction). */
export class MaterialsReader {
  constructor(private readonly db: Exec) {}

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
    // Kept as bigint (postgres.js hands back a string): 4096 chests ×
    // 1e8 omitted entries overflows int4, so no `::int` cast (Codex r1).
    const [row] = await this.db
      .select({
        chestCount: sql<string>`count(*)`,
        unreadable: sql<string>`count(*) FILTER (WHERE ${c.unreadable})`,
        omittedEntries: sql<string>`coalesce(sum(${c.omittedEntries}), 0)::bigint`,
      })
      .from(c)
      .where(and(eq(c.scanId, scanId), scope));
    return toCountsRow(row);
  }

  /**
   * The scope's containers, sorted `prefab, x, z, y` (then key); with
   * `holding`, only those with a stack of that prefab (same scope — Codex r2).
   */
  listContainers(
    scanId: number,
    scope: ContainerScope,
    holding: string | null,
  ): Promise<MaterialsContainerRow[]> {
    const holds =
      holding === null
        ? undefined
        : sql`EXISTS (SELECT 1 FROM ${st} s
            WHERE s.container_id = ${c.id} AND s.prefab = ${holding})`;
    return this.db
      .select(summaryCols)
      .from(c)
      .where(and(eq(c.scanId, scanId), scope, holds))
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
