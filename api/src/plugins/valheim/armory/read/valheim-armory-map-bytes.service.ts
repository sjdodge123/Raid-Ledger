/**
 * ROK-1837 L2 — bytes behind the map tab: the base-map PNG (D3) and the
 * stored gzip fog bitsets (D4). Every lookup is scoped to the character
 * that owns the map and the MAP's server; the base map is located by
 * `(server, sha256)` → `valheim_link_blobs.storage_path` only. A hidden
 * hub answers non-staff `Guild not found` first (ROK-1856, L-5).
 */
import * as path from 'node:path';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ValheimMapFogLayer } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { getValheimLinkBlobDir } from '../../link/blobs/valheim-link-blob.store';
import type { GuildActor } from '../../../../guilds/guild-access.service';
import { assertCharacterHubVisible } from './valheim-armory-hub-visibility.helpers';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import type { ValheimBitmapLike } from '../../link/ingest/valheim-link-bitmap.helpers';
import { ValheimMapMaskCache } from './valheim-map-mask.cache';
import {
  maskEtag,
  maskFingerprint,
  unionBitsets,
  type MaskBitmapRef,
} from './valheim-map-mask.helpers';
import { renderMaskedBaseMap } from './valheim-map-mask.render';
import {
  ValheimMapMaskRepository,
  type MaskMapRow,
  type ViewerWorldBitmaps,
} from './valheim-map-mask.repository';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimMaps: m } = schema;

/**
 * The viewer's masked base map (ROK-1949 D2/D7): the ETag is computed from
 * the inputs alone, so a 304 never calls `bytes()` (no decode, no render).
 */
export interface MaskedBaseMap {
  etag: string;
  bytes: () => Promise<Buffer>;
}

/** The bitmaps that unmask map `M` for a viewer, plus their cache refs. */
export interface MaskLayers {
  refs: MaskBitmapRef[];
  bitmaps: ValheimBitmapLike[];
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

/**
 * D1 — `M.shared ∪ ⋃ (c.explored ∪ c.shared)` over the viewer's own claimed
 * characters `c` on M's world. Staff get no bypass; no claim → shared only.
 */
export function collectMaskLayers(
  map: MaskMapRow,
  own: readonly ViewerWorldBitmaps[],
): MaskLayers {
  const out: MaskLayers = { refs: [], bitmaps: [] };
  const add = (mapId: number, layer: MaskBitmapRef['layer'], at: Date) =>
    out.refs.push({ mapId, layer, capturedAtMs: at.getTime() });
  if (map.shared) {
    add(map.id, 'shared', map.capturedAt);
    out.bitmaps.push(map.shared);
  }
  for (const c of own) {
    add(c.mapId, 'personal', c.capturedAt);
    out.bitmaps.push(c.explored);
    if (c.shared) {
      add(c.mapId, 'shared', c.capturedAt);
      out.bitmaps.push(c.shared);
    }
  }
  return out;
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
    private readonly masks: ValheimMapMaskRepository,
    private readonly cache: ValheimMapMaskCache,
  ) {}

  private readonly logger = new Logger(ValheimArmoryMapBytesService.name);

  /**
   * The base map masked to what `actor` has explored (ROK-1949). Fails
   * closed: any lookup, decode or render failure is `base_map_not_ready`,
   * and no path ever returns the stored file's bytes.
   */
  async baseMap(
    id: number,
    mapId: number,
    actor: GuildActor,
  ): Promise<MaskedBaseMap> {
    await assertCharacterHubVisible(this.reads, actor, id);
    const map = await this.masks.findMap(mapId, id);
    if (!map) throw new NotFoundException('Map not found');
    const { sha256 } = map;
    if (sha256 === null) throw notReady();
    const absPath = await this.basePath(map.serverId, sha256);
    const n = map.textureSize;
    const own = await this.masks.findViewerWorldBitmaps(
      actor.id,
      map.serverId,
      map.worldUid,
      n,
    );
    const { refs, bitmaps } = collectMaskLayers(map, own);
    const fp = maskFingerprint({
      baseSha: sha256,
      textureSize: n,
      bitmaps: refs,
    });
    return {
      etag: maskEtag(fp),
      bytes: () =>
        this.render(fp, mapId, () =>
          renderMaskedBaseMap(absPath, n, unionBitsets(bitmaps, n)),
        ),
    };
  }

  /** The base map's file inside the blob root, or `base_map_not_ready`. */
  private async basePath(serverId: number, sha256: string): Promise<string> {
    const rel = await this.masks.findBaseMapBlobPath(serverId, sha256);
    const absPath = rel === null ? null : containedBlobPath(rel);
    if (absPath === null) throw notReady();
    return absPath;
  }

  /** Cached render; every failure becomes a 404 (D5), logged by map id only. */
  private async render(
    fp: string,
    mapId: number,
    produce: () => Promise<Buffer>,
  ): Promise<Buffer> {
    try {
      return await this.cache.get(fp, produce);
    } catch (err: unknown) {
      const kind = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(`base map mask failed for map ${mapId} (${kind})`);
      throw notReady();
    }
  }

  /** The stored gzip bytes of one fog layer (never inflated, never logged). */
  async fog(
    id: number,
    mapId: number,
    layer: ValheimMapFogLayer,
    actor: GuildActor,
  ): Promise<FogBytes> {
    await assertCharacterHubVisible(this.reads, actor, id);
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
    if (!bitmap) throw new NotFoundException(`no_${layer}_layer`);
    return {
      bytes: Buffer.from(bitmap.data, 'base64'),
      etag: fogEtag(layer, row.capturedAt),
    };
  }
}
