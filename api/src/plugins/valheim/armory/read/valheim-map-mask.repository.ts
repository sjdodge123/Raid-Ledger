/**
 * ROK-1949 D1/D8 — the reads behind the masked base map: the viewed map
 * row, the viewer's own claimed characters' bitmaps on the same world, and
 * the base-map blob path WITHOUT the blob route's base-map refusal.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ValheimBitmapLike } from '../../link/ingest/valheim-link-bitmap.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimMaps: m, valheimProfiles: p, valheimLinkBlobs: blobs } = schema;

/** The viewed map row: what locates the PNG and its shared layer. */
export interface MaskMapRow {
  id: number;
  serverId: number;
  worldUid: string;
  textureSize: number;
  /** Union only bitmaps of identical geometry (texture size + metres/px). */
  pixelSizeMetres: number;
  sha256: string | null;
  shared: ValheimBitmapLike | null;
  capturedAt: Date;
}

/** One of the viewer's claimed characters' maps on the same world. */
export interface ViewerWorldBitmaps {
  mapId: number;
  explored: ValheimBitmapLike;
  shared: ValheimBitmapLike | null;
  capturedAt: Date;
}

@Injectable()
export class ValheimMapMaskRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Map `mapId` when it belongs to character `profileId`. */
  async findMap(mapId: number, profileId: number): Promise<MaskMapRow | null> {
    const [row] = await this.db
      .select({
        id: m.id,
        serverId: m.pelicanServerId,
        worldUid: m.worldUid,
        textureSize: m.textureSize,
        pixelSizeMetres: m.pixelSizeMetres,
        sha256: m.baseMapSha256,
        shared: m.sharedExplored,
        capturedAt: m.capturedAt,
      })
      .from(m)
      .where(and(eq(m.id, mapId), eq(m.profileId, profileId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Bitmaps of every map on M's `(server, world)` with M's exact geometry
   * (texture size AND metres/pixel) whose profile `userId` claimed.
   */
  findViewerWorldBitmaps(
    userId: number,
    map: Pick<
      MaskMapRow,
      'serverId' | 'worldUid' | 'textureSize' | 'pixelSizeMetres'
    >,
  ): Promise<ViewerWorldBitmaps[]> {
    return this.db
      .select({
        mapId: m.id,
        explored: m.explored,
        shared: m.sharedExplored,
        capturedAt: m.capturedAt,
      })
      .from(m)
      .innerJoin(p, eq(p.id, m.profileId))
      .where(
        and(
          eq(p.claimedBy, userId),
          eq(m.pelicanServerId, map.serverId),
          eq(m.worldUid, map.worldUid),
          eq(m.textureSize, map.textureSize),
          eq(m.pixelSizeMetres, map.pixelSizeMetres),
        ),
      );
  }

  /** The base map's `storage_path` by `(server, sha256)` (no base-map filter). */
  async findBaseMapBlobPath(
    serverId: number,
    sha256: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ storagePath: blobs.storagePath })
      .from(blobs)
      .where(
        and(
          eq(blobs.pelicanServerId, serverId),
          eq(blobs.sha256, sha256),
          eq(blobs.contentType, 'image/png'),
        ),
      )
      .limit(1);
    return row?.storagePath ?? null;
  }
}
