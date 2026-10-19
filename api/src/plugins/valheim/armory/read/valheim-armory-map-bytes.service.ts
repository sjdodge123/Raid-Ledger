/**
 * ROK-1837 L2 — bytes behind the map tab: the base-map PNG (D3) and the
 * stored gzip fog bitsets (D4). Every lookup is scoped to the character
 * that owns the map and the MAP's server; the base map is located by
 * `(server, sha256)` → `valheim_link_blobs.storage_path` only.
 */
import * as path from 'node:path';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ValheimMapFogLayer } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { getValheimLinkBlobDir } from '../../link/blobs/valheim-link-blob.store';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimMaps: m } = schema;

/** A base map resolved to an on-disk file inside the blob root. */
export interface BaseMapFile {
  sha256: string;
  absPath: string;
}

/** One fog layer's stored gzip bytes plus its validator. */
export interface FogBytes {
  bytes: Buffer;
  etag: string;
}

const notReady = () => new NotFoundException('base_map_not_ready');

/**
 * Absolute path of `relative` under the blob root, or `null` when it
 * would escape it (`../`, an absolute path) — a tampered row is never read.
 */
export function containedBlobPath(relative: string): string | null {
  const root = path.resolve(getValheimLinkBlobDir());
  const abs = path.resolve(root, relative);
  return abs.startsWith(root + path.sep) ? abs : null;
}

/** Strong validator for a fog layer: the layer plus the capture instant. */
export function fogEtag(layer: ValheimMapFogLayer, capturedAt: Date): string {
  return `"${layer}-${capturedAt.getTime()}"`;
}

@Injectable()
export class ValheimArmoryMapBytesService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly reads: ValheimArmoryReadRepository,
  ) {}

  /** The map's base-map file; 404 unless the map is the character's and ready. */
  async baseMap(id: number, mapId: number): Promise<BaseMapFile> {
    const [row] = await this.db
      .select({ serverId: m.pelicanServerId, sha256: m.baseMapSha256 })
      .from(m)
      .where(and(eq(m.id, mapId), eq(m.profileId, id)))
      .limit(1);
    if (!row) throw new NotFoundException('Map not found');
    if (row.sha256 === null) throw notReady();
    const rel = await this.reads.findBlobPath(row.serverId, row.sha256);
    const absPath = rel === null ? null : containedBlobPath(rel);
    if (absPath === null) throw notReady();
    return { sha256: row.sha256, absPath };
  }

  /** The stored gzip bytes of one fog layer (never inflated, never logged). */
  async fog(
    id: number,
    mapId: number,
    layer: ValheimMapFogLayer,
  ): Promise<FogBytes> {
    const [row] = await this.db
      .select({
        explored: m.explored,
        shared: m.sharedExplored,
        capturedAt: m.capturedAt,
      })
      .from(m)
      .where(and(eq(m.id, mapId), eq(m.profileId, id)))
      .limit(1);
    if (!row) throw new NotFoundException('Map not found');
    const bitmap = layer === 'shared' ? row.shared : row.explored;
    if (!bitmap) throw new NotFoundException('no_shared_layer');
    return {
      bytes: Buffer.from(bitmap.data, 'base64'),
      etag: fogEtag(layer, row.capturedAt),
    };
  }
}
