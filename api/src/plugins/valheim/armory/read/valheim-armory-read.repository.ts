/**
 * ROK-1835 L4 — read-only queries behind the armory read routes. Columns are
 * selected explicitly; the SteamID64 is selected for the admin list mapper
 * only and dropped by `toSummary` everywhere else.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type {
  ArmoryDetailReadRow,
  ArmoryMapReadRow,
  ArmoryMapRefRow,
  ArmoryProfileReadRow,
} from './valheim-armory-read.mappers';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimProfiles: p, valheimMaps: m, pelicanServers: s, users: u } =
  schema;
const blobs = schema.valheimLinkBlobs;

/** List filters + page window. */
export interface ArmoryListFilter {
  serverId?: number | undefined;
  unclaimed?: boolean | undefined;
  limit: number;
  offset: number;
}

const summaryCols = {
  id: p.id,
  pelicanServerId: p.pelicanServerId,
  serverName: s.name,
  name: p.name,
  worldName: p.worldName,
  steamId: p.steamId,
  claimSource: p.claimSource,
  capturedAt: p.capturedAt,
  gameVersion: p.gameVersion,
  ownerId: u.id,
  ownerUsername: u.username,
  ownerAvatar: u.avatar,
};

const sheetCols = {
  equipment: p.equipment,
  inventory: p.inventory,
  skills: p.skills,
  trophies: p.trophies,
};

/** D8: readiness is computed at read time from the blob table. */
const baseMapReady = sql<boolean>`EXISTS (
  SELECT 1 FROM ${blobs} b
  WHERE b.pelican_server_id = ${m.pelicanServerId}
    AND b.sha256 = ${m.baseMapSha256})`;

function listWhere(f: ArmoryListFilter): SQL | undefined {
  const parts: SQL[] = [];
  if (f.serverId !== undefined) parts.push(eq(p.pelicanServerId, f.serverId));
  if (f.unclaimed === true) parts.push(isNull(p.claimedBy));
  return parts.length > 0 ? and(...parts) : undefined;
}

@Injectable()
export class ValheimArmoryReadRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Profiles sorted by name (then id), one page. */
  listProfiles(f: ArmoryListFilter): Promise<ArmoryProfileReadRow[]> {
    return this.db
      .select(summaryCols)
      .from(p)
      .innerJoin(s, eq(s.id, p.pelicanServerId))
      .leftJoin(u, eq(u.id, p.claimedBy))
      .where(listWhere(f))
      .orderBy(asc(p.name), asc(p.id))
      .limit(f.limit)
      .offset(f.offset);
  }

  /** One profile with its sheet, or null. */
  async findProfile(id: number): Promise<ArmoryDetailReadRow | null> {
    const [row] = await this.db
      .select({ ...summaryCols, ...sheetCols })
      .from(p)
      .innerJoin(s, eq(s.id, p.pelicanServerId))
      .leftJoin(u, eq(u.id, p.claimedBy))
      .where(eq(p.id, id))
      .limit(1);
    return row ?? null;
  }

  /** The character's maps (one per world), by world uid. */
  listMapRefs(profileId: number): Promise<ArmoryMapRefRow[]> {
    return this.db
      .select({ id: m.id, worldUid: m.worldUid, capturedAt: m.capturedAt })
      .from(m)
      .where(eq(m.profileId, profileId))
      .orderBy(asc(m.worldUid), asc(m.id));
  }

  /** A map that belongs to the character, or null. */
  async findMap(
    profileId: number,
    mapId: number,
  ): Promise<ArmoryMapReadRow | null> {
    const [row] = await this.db
      .select({
        id: m.id,
        worldUid: m.worldUid,
        textureSize: m.textureSize,
        pixelSizeMetres: m.pixelSizeMetres,
        pins: m.pins,
        hasSharedExplored: sql<boolean>`${m.sharedExplored} IS NOT NULL`,
        baseMapSha256: m.baseMapSha256,
        baseMapWidth: m.baseMapWidth,
        baseMapHeight: m.baseMapHeight,
        baseMapReady,
        capturedAt: m.capturedAt,
      })
      .from(m)
      .where(and(eq(m.id, mapId), eq(m.profileId, profileId)))
      .limit(1);
    return row ?? null;
  }
}
