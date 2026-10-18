import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import type { ArmorySnapshot } from './valheim-armory.mappers';

type Db = PostgresJsDatabase<typeof schema>;
type Exec = Db | ValheimLinkTx;
const {
  valheimLinkSnapshots: snapshots,
  valheimLinkBlobs: blobs,
  valheimProfiles: profiles,
  valheimMaps: maps,
  valheimItemCatalogs: catalogs,
} = schema;

/** Terminal statuses the importer writes on a snapshot (ROK-1835). */
export type ArmorySnapshotStatus =
  'imported' | 'failed' | 'skipped_stale' | 'waiting_blob';

/** A drain candidate: id + the `received_at::text` version it was read at. */
export interface ArmoryCandidate {
  id: number;
  receivedAt: string;
}

const receivedText = sql<string>`${snapshots.receivedAt}::text`;
/** Same row version as read — ingest's replace bumps `received_at`. */
const sameVersion = (c: ArmoryCandidate) =>
  and(
    eq(snapshots.id, c.id),
    sql`${snapshots.receivedAt} = ${c.receivedAt}::timestamptz`,
  );
/** `waiting_blob` rows become importable once their base-map PNG exists. */
const blobArrived = sql`NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(${snapshots.blobRefs}) r
  WHERE r->>'role' = 'baseMap' AND NOT EXISTS (
    SELECT 1 FROM ${blobs} b
    WHERE b.pelican_server_id = ${snapshots.pelicanServerId}
      AND b.sha256 = r->>'sha256'))`;
const importable = or(
  eq(snapshots.status, 'pending'),
  and(eq(snapshots.status, 'waiting_blob'), blobArrived),
);
/** Latest wins; equal `captured_at` rewrites identical data (idempotent). */
const notOlder = (col: typeof profiles.capturedAt) =>
  sql`${col} <= excluded.captured_at`;
/** `{ key: excluded."<column>" }` for an ON CONFLICT DO UPDATE set. */
const fromExcluded = (cols: Record<string, { name: string }>) =>
  Object.fromEntries(
    Object.entries(cols).map(([k, c]) => [k, sql.raw(`excluded."${c.name}"`)]),
  );

/** Snapshot status transitions + armory upserts for the importer. */
@Injectable()
export class ValheimArmoryRepository {
  constructor(@Inject(DrizzleAsyncProvider) readonly db: Db) {}

  /** Oldest importable snapshots first (`(status, received_at)` index). */
  async listCandidates(limit: number): Promise<ArmoryCandidate[]> {
    return this.db
      .select({ id: snapshots.id, receivedAt: receivedText })
      .from(snapshots)
      .where(importable)
      .orderBy(asc(snapshots.receivedAt))
      .limit(limit);
  }

  /**
   * Lock one candidate (`FOR UPDATE SKIP LOCKED`) if it is still importable
   * and unchanged since it was listed; null = taken / replaced / done.
   */
  async lockSnapshot(
    tx: ValheimLinkTx,
    c: ArmoryCandidate,
  ): Promise<ArmorySnapshot | null> {
    const [row] = await tx
      .select({
        id: snapshots.id,
        pelicanServerId: snapshots.pelicanServerId,
        kind: snapshots.kind,
        steamId: snapshots.steamId,
        playerId: snapshots.playerId,
        worldUid: snapshots.worldUid,
        receivedAt: receivedText,
        payload: snapshots.payload,
      })
      .from(snapshots)
      .where(and(sameVersion(c), inArray(snapshots.status, ['pending', 'waiting_blob'])))
      .for('update', { skipLocked: true });
    return row ?? null;
  }

  /** Set a status only if the row is unchanged; false = ingest replaced it. */
  async markStatus(
    exec: Exec,
    c: ArmoryCandidate,
    status: ArmorySnapshotStatus,
    detail: string | null,
  ): Promise<boolean> {
    const done = await exec
      .update(snapshots)
      .set({ status, statusDetail: detail })
      .where(sameVersion(c))
      .returning({ id: snapshots.id });
    return done.length > 0;
  }

  /** Upsert on `valheim_profiles_identity_uq`; null when the row is newer. */
  async upsertProfile(
    tx: ValheimLinkTx,
    values: schema.NewValheimProfile,
  ): Promise<schema.ValheimProfileRow | null> {
    const [row] = await tx
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({
        target: [profiles.pelicanServerId, profiles.steamId, profiles.playerId],
        set: {
          ...fromExcluded(PROFILE_SHEET_COLUMNS),
          importedAt: sql`now()`,
        },
        setWhere: notOlder(profiles.capturedAt),
      })
      .returning();
    return row ?? null;
  }

  /** Back-fill `profile_id` on this character's maps that landed first (D3). */
  async backfillMapProfile(
    tx: ValheimLinkTx,
    p: schema.ValheimProfileRow,
  ): Promise<void> {
    await tx
      .update(maps)
      .set({ profileId: p.id })
      .where(
        and(
          eq(maps.pelicanServerId, p.pelicanServerId),
          eq(maps.steamId, p.steamId),
          eq(maps.playerId, p.playerId),
          isNull(maps.profileId),
        ),
      );
  }

  /** The profile id for a map's character, or null if none yet. */
  async findProfileId(
    tx: ValheimLinkTx,
    key: { pelicanServerId: number; steamId: string; playerId: string },
  ): Promise<number | null> {
    const [row] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.pelicanServerId, key.pelicanServerId),
          eq(profiles.steamId, key.steamId),
          eq(profiles.playerId, key.playerId),
        ),
      );
    return row?.id ?? null;
  }

  /** Upsert on `valheim_maps_identity_uq`; false when the stored map is newer. */
  async upsertMap(tx: ValheimLinkTx, values: schema.NewValheimMap): Promise<boolean> {
    const done = await tx
      .insert(maps)
      .values(values)
      .onConflictDoUpdate({
        target: [maps.pelicanServerId, maps.steamId, maps.playerId, maps.worldUid],
        set: {
          ...fromExcluded(MAP_COLUMNS),
          profileId: sql`COALESCE(excluded.profile_id, ${maps.profileId})`,
          importedAt: sql`now()`,
        },
        setWhere: notOlder(maps.capturedAt),
      })
      .returning({ id: maps.id });
    return done.length > 0;
  }

  /** Upsert on `valheim_item_catalogs_version_uq`; false when stored is newer. */
  async upsertCatalog(
    tx: ValheimLinkTx,
    values: schema.NewValheimItemCatalog,
  ): Promise<boolean> {
    const done = await tx
      .insert(catalogs)
      .values(values)
      .onConflictDoUpdate({
        target: [catalogs.pelicanServerId, catalogs.gameVersion],
        set: { ...fromExcluded(CATALOG_COLUMNS), importedAt: sql`now()` },
        setWhere: notOlder(catalogs.capturedAt),
      })
      .returning({ id: catalogs.id });
    return done.length > 0;
  }

  /** Whether this server has uploaded the PNG with this sha256 (R6 scope). */
  async blobExists(tx: ValheimLinkTx, server: number, sha256: string): Promise<boolean> {
    const [row] = await tx
      .select({ sha: blobs.sha256 })
      .from(blobs)
      .where(and(eq(blobs.pelicanServerId, server), eq(blobs.sha256, sha256)));
    return row !== undefined;
  }
}

/** Replaced on re-import — never the claim columns (identity is L3's). */
const PROFILE_SHEET_COLUMNS = {
  worldUid: profiles.worldUid,
  worldName: profiles.worldName,
  name: profiles.name,
  gameVersion: profiles.gameVersion,
  modVersion: profiles.modVersion,
  capturedAt: profiles.capturedAt,
  equipment: profiles.equipment,
  inventory: profiles.inventory,
  skills: profiles.skills,
  trophies: profiles.trophies,
  knownItems: profiles.knownItems,
  knownRecipes: profiles.knownRecipes,
  sourceSnapshotId: profiles.sourceSnapshotId,
};
/** `profile_id` is COALESCEd separately (kept when the new map has none). */
const MAP_COLUMNS = {
  textureSize: maps.textureSize,
  pixelSizeMetres: maps.pixelSizeMetres,
  explored: maps.explored,
  sharedExplored: maps.sharedExplored,
  pins: maps.pins,
  baseMapSha256: maps.baseMapSha256,
  baseMapWidth: maps.baseMapWidth,
  baseMapHeight: maps.baseMapHeight,
  gameVersion: maps.gameVersion,
  capturedAt: maps.capturedAt,
  sourceSnapshotId: maps.sourceSnapshotId,
};
const CATALOG_COLUMNS = {
  locale: catalogs.locale,
  atlasSha256: catalogs.atlasSha256,
  atlasWidth: catalogs.atlasWidth,
  atlasHeight: catalogs.atlasHeight,
  items: catalogs.items,
  capturedAt: catalogs.capturedAt,
  sourceSnapshotId: catalogs.sourceSnapshotId,
};
