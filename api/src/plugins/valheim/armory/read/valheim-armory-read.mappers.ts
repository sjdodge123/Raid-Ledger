/**
 * ROK-1835 L4 — pure row → response mappers for the armory read routes.
 * Every key is listed explicitly (no spread of a DB row), so a stored
 * SteamID64 cannot reach a member response (Q10); only `toAdminSummary`
 * adds it, for the admin owner-management list.
 */
import type {
  ValheimCharacterDetail,
  ValheimCharacterMapRef,
  ValheimCharacterOwner,
  ValheimCharacterSummary,
  ValheimClaimSource,
  ValheimMapBaseMap,
  ValheimMapMeta,
} from '@raid-ledger/contract';
import type {
  ValheimMapRow,
  ValheimProfileRow,
} from '../../../../drizzle/schema';

/** A profile joined with its server name and owner, as the list reads it. */
export interface ArmoryProfileReadRow {
  id: number;
  pelicanServerId: number;
  serverName: string;
  name: string;
  worldName: string;
  steamId: string;
  claimSource: ValheimClaimSource | null;
  capturedAt: Date;
  gameVersion: string;
  ownerId: number | null;
  ownerUsername: string | null;
  ownerAvatar: string | null;
}

/** The list row plus the character sheet columns. */
export type ArmoryDetailReadRow = ArmoryProfileReadRow &
  Pick<ValheimProfileRow, 'equipment' | 'inventory' | 'skills' | 'trophies'>;

/** A map ref as read: id, world and capture time. */
export interface ArmoryMapRefRow {
  id: number;
  worldUid: string;
  capturedAt: Date;
}

/** A map row as the map-meta route reads it (no fog bitmaps — V7). */
export type ArmoryMapReadRow = Pick<
  ValheimMapRow,
  | 'id'
  | 'worldUid'
  | 'textureSize'
  | 'pixelSizeMetres'
  | 'pins'
  | 'baseMapSha256'
  | 'baseMapWidth'
  | 'baseMapHeight'
  | 'capturedAt'
> & { hasSharedExplored: boolean; baseMapReady: boolean };

/** Admin-only list entry: the summary plus the mod-asserted SteamID64. */
export type ValheimAdminCharacterSummary = ValheimCharacterSummary & {
  steamId64: string;
};

function toOwner(row: ArmoryProfileReadRow): ValheimCharacterOwner | null {
  if (row.ownerId === null || row.ownerUsername === null) return null;
  return {
    id: row.ownerId,
    username: row.ownerUsername,
    avatar: row.ownerAvatar,
  };
}

/** Member-visible list entry; never carries the SteamID64. */
export function toSummary(row: ArmoryProfileReadRow): ValheimCharacterSummary {
  return {
    id: row.id,
    pelicanServerId: row.pelicanServerId,
    serverName: row.serverName,
    name: row.name,
    worldName: row.worldName,
    claimedBy: toOwner(row),
    claimSource: row.claimSource,
    capturedAt: row.capturedAt.toISOString(),
    gameVersion: row.gameVersion,
  };
}

/** Admin list entry — the only read shape that includes `steamId64`. */
export function toAdminSummary(
  row: ArmoryProfileReadRow,
): ValheimAdminCharacterSummary {
  return { ...toSummary(row), steamId64: row.steamId };
}

/** Map ref for the detail's `maps` list. */
export function toMapRef(row: ArmoryMapRefRow): ValheimCharacterMapRef {
  return {
    id: row.id,
    worldUid: row.worldUid,
    capturedAt: row.capturedAt.toISOString(),
  };
}

/** Character detail: summary + sheet + the character's maps. */
export function toDetail(
  row: ArmoryDetailReadRow,
  maps: ArmoryMapRefRow[],
): ValheimCharacterDetail {
  return {
    ...toSummary(row),
    equipment: row.equipment,
    inventory: row.inventory,
    skills: row.skills,
    trophies: row.trophies,
    maps: maps.map(toMapRef),
  };
}

function toBaseMap(row: ArmoryMapReadRow): ValheimMapBaseMap | null {
  const { baseMapSha256: sha256, baseMapWidth: width } = row;
  const height = row.baseMapHeight;
  if (sha256 === null || width === null || height === null) return null;
  return { sha256, width, height, ready: row.baseMapReady };
}

/** Map metadata; blob bytes and fog bitmaps are V7's (Q7). */
export function toMapMeta(row: ArmoryMapReadRow): ValheimMapMeta {
  return {
    id: row.id,
    worldUid: row.worldUid,
    grid: {
      textureSize: row.textureSize,
      pixelSizeMetres: row.pixelSizeMetres,
    },
    pins: row.pins,
    hasSharedExplored: row.hasSharedExplored,
    baseMap: toBaseMap(row),
    capturedAt: row.capturedAt.toISOString(),
  };
}
