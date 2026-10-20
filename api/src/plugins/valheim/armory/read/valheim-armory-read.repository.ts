/**
 * ROK-1835 L4 — read-only queries behind the armory read routes. Columns are
 * selected explicitly; the SteamID64 is selected for the admin list mapper
 * only and dropped by `toSummary` everywhere else.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ArmoryCatalogReadRow } from './valheim-armory-catalog.helpers';
import type {
  ArmoryDetailReadRow,
  ArmoryMapReadRow,
  ArmoryMapRefRow,
  ArmoryProfileReadRow,
} from './valheim-armory-read.mappers';

type Db = PostgresJsDatabase<typeof schema>;
const {
  valheimProfiles: p,
  valheimMaps: m,
  pelicanServers: s,
  users: u,
} = schema;
const blobs = schema.valheimLinkBlobs;
const hubs = schema.guilds;
const cat = schema.valheimItemCatalogs;

/** List filters + page window. */
export interface ArmoryListFilter {
  serverId?: number | undefined;
  unclaimed?: boolean | undefined;
  /** ROK-1856: drop characters whose server's hub is hidden (non-staff). */
  hideHiddenHubs?: boolean | undefined;
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
  ownerDiscordId: u.discordId,
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

/** ROK-1836: the atlas is ready once its blob row exists for the server. */
export const atlasReady = sql<boolean>`EXISTS (
  SELECT 1 FROM ${blobs} b
  WHERE b.pelican_server_id = ${cat.pelicanServerId}
    AND b.sha256 = ${cat.atlasSha256})`;

/** Only the referenced prefabs leave the database — never the whole jsonb. */
export function itemsSubset(prefabs: readonly string[]) {
  if (prefabs.length === 0) return sql`'{}'::jsonb`.mapWith(cat.items);
  const list = sql.join(
    prefabs.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`COALESCE((SELECT jsonb_object_agg(e.key, e.value)
    FROM jsonb_each(${cat.items}) e WHERE e.key IN (${list})), '{}'::jsonb)`.mapWith(
    cat.items,
  );
}

/** ROK-1856 (L-5 list filter): the profile's server has no hidden hub. */
const notOnHiddenHub = sql`NOT EXISTS (
  SELECT 1 FROM ${hubs} h
  WHERE h.pelican_server_id = ${p.pelicanServerId}
    AND h.hidden_at IS NOT NULL)`;

function listWhere(f: ArmoryListFilter): SQL | undefined {
  const parts: SQL[] = [];
  if (f.serverId !== undefined) parts.push(eq(p.pelicanServerId, f.serverId));
  if (f.unclaimed === true) parts.push(isNull(p.claimedBy));
  if (f.hideHiddenHubs === true) parts.push(notOnHiddenHub);
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

  /** Rows matching the list filters (the `total` beside a page). */
  async countProfiles(f: ArmoryListFilter): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(p)
      .where(listWhere(f));
    return row?.n ?? 0;
  }

  /** The ROK-1831 community hub keyed to a Pelican server, or null. */
  async findServerHub(
    serverId: number,
  ): Promise<{ id: number; hidden: boolean } | null> {
    const [row] = await this.db
      .select({
        id: hubs.id,
        hidden: sql<boolean>`${hubs.hiddenAt} IS NOT NULL`,
      })
      .from(hubs)
      .where(eq(hubs.pelicanServerId, serverId))
      .limit(1);
    return row ?? null;
  }

  /** The hub of the character's server (ROK-1856), or null (no profile/hub). */
  async findProfileHub(
    profileId: number,
  ): Promise<{ id: number; hidden: boolean } | null> {
    const [row] = await this.db
      .select({
        id: hubs.id,
        hidden: sql<boolean>`${hubs.hiddenAt} IS NOT NULL`,
      })
      .from(p)
      .innerJoin(hubs, eq(hubs.pelicanServerId, p.pelicanServerId))
      .where(eq(p.id, profileId))
      .limit(1);
    return row ?? null;
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

  /** The catalogue subset for `(server, game version)`, or null (D4). */
  async findCatalog(
    serverId: number,
    gameVersion: string,
    prefabs: readonly string[],
  ): Promise<ArmoryCatalogReadRow | null> {
    const [row] = await this.db
      .select({
        items: itemsSubset(prefabs),
        atlasSha256: cat.atlasSha256,
        atlasWidth: cat.atlasWidth,
        atlasHeight: cat.atlasHeight,
        atlasReady,
      })
      .from(cat)
      .where(
        and(
          eq(cat.pelicanServerId, serverId),
          eq(cat.gameVersion, gameVersion),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** A stored PNG's `storage_path`, by `(server, sha256)` only (D5, R6). */
  async findBlobPath(serverId: number, sha256: string): Promise<string | null> {
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
