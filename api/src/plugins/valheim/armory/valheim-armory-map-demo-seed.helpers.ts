/**
 * ROK-1837 L3 — DEMO_MODE map fixture writes: a generated 2048² base-map
 * PNG (four flat quadrants + a centre cross, so fog/pin alignment is
 * eyeball-checkable) stored under the ROK-1833 blob convention with its
 * real sha256, and the caller's `valheim_maps` row from the inlined
 * `map-shared-layer.json` (personal + shared layers, 4 pins).
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import sharp from 'sharp';
import * as schema from '../../../drizzle/schema';
import type { NewValheimMap } from '../../../drizzle/schema';
import {
  blobAbsolutePath,
  blobRelativePath,
} from '../link/blobs/valheim-link-blob.store';
import { ARMORY_FIXTURE_GAME_VERSION } from './valheim-armory-demo-seed.helpers';
import {
  MAP_FIXTURE_EXPLORED,
  MAP_FIXTURE_GRID,
  MAP_FIXTURE_IDENTITY,
  MAP_FIXTURE_PINS,
  MAP_FIXTURE_PLACEHOLDER_SHA256,
  MAP_FIXTURE_SHARED_EXPLORED,
} from './valheim-armory-map-demo-fixture';

type Db = PostgresJsDatabase<typeof schema>;
type Rgb = [number, number, number];

export const MAP_PNG_SIZE = 2048;
const CROSS_HALF_WIDTH = 4;
const CROSS: Rgb = [245, 245, 245];
/** North-west, north-east, south-west, south-east (screen orientation). */
const QUADRANTS: [Rgb, Rgb, Rgb, Rgb] = [
  [46, 125, 50],
  [21, 101, 192],
  [198, 40, 40],
  [249, 168, 37],
];

/** RGB of one base-map pixel (`y` = screen row, 0 = north). */
export function mapPixel(x: number, y: number): Rgb {
  const c = MAP_PNG_SIZE / 2;
  const onCross =
    Math.abs(x - c) < CROSS_HALF_WIDTH || Math.abs(y - c) < CROSS_HALF_WIDTH;
  if (onCross) return CROSS;
  return QUADRANTS[(y < c ? 0 : 2) + (x < c ? 0 : 1)] ?? CROSS;
}

/** Encodes `MAP_PNG_SIZE`² raw RGB to PNG (injectable for the cache spec). */
export type MapPngEncoder = (raw: Buffer, size: number) => Promise<Buffer>;

const sharpEncode: MapPngEncoder = (raw, n) =>
  sharp(raw, { raw: { width: n, height: n, channels: 3 } })
    .png()
    .toBuffer();

let rendered: Promise<Buffer> | null = null;

/** The base-map PNG via `sharp` (deterministic → the same sha each run). */
export function renderDemoBaseMap(
  encode: MapPngEncoder = sharpEncode,
): Promise<Buffer> {
  if (rendered) return rendered;
  const n = MAP_PNG_SIZE;
  const raw = Buffer.alloc(n * n * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) raw.set(mapPixel(x, y), (y * n + x) * 3);
  }
  rendered = encode(raw, n);
  return rendered;
}

/** Write the PNG + its blob row (idempotent); returns its sha256. */
export async function storeDemoBaseMap(
  db: Db,
  serverId: number,
): Promise<string> {
  const bytes = await renderDemoBaseMap();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const rel = blobRelativePath(serverId, sha256);
  await mkdir(path.dirname(blobAbsolutePath(rel)), { recursive: true });
  await writeFile(blobAbsolutePath(rel), bytes);
  await db
    .insert(schema.valheimLinkBlobs)
    .values({
      pelicanServerId: serverId,
      sha256,
      byteLength: bytes.length,
      contentType: 'image/png',
      width: MAP_PNG_SIZE,
      height: MAP_PNG_SIZE,
      storagePath: rel,
    })
    .onConflictDoNothing();
  return sha256;
}

function mapValues(
  serverId: number,
  profileId: number,
  baseMapSha256: string | null,
): NewValheimMap {
  return {
    pelicanServerId: serverId,
    ...MAP_FIXTURE_IDENTITY,
    profileId,
    ...MAP_FIXTURE_GRID,
    explored: MAP_FIXTURE_EXPLORED,
    sharedExplored: MAP_FIXTURE_SHARED_EXPLORED,
    pins: MAP_FIXTURE_PINS,
    baseMapSha256: baseMapSha256 ?? MAP_FIXTURE_PLACEHOLDER_SHA256,
    baseMapWidth: MAP_PNG_SIZE,
    baseMapHeight: MAP_PNG_SIZE,
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    capturedAt: new Date(),
  };
}

/**
 * Replace the fixture identity's map on `serverId` (idempotent) and link
 * it to `profileId`. `baseMapSha256` null keeps the fixture's placeholder
 * hash with no blob behind it → the byte route answers `base_map_not_ready`.
 */
export async function upsertDemoMap(
  db: Db,
  serverId: number,
  profileId: number,
  baseMapSha256: string | null,
): Promise<number> {
  const M = schema.valheimMaps;
  const { steamId, playerId, worldUid } = MAP_FIXTURE_IDENTITY;
  await db
    .delete(M)
    .where(
      and(
        eq(M.pelicanServerId, serverId),
        eq(M.steamId, steamId),
        eq(M.playerId, playerId),
        eq(M.worldUid, worldUid),
      ),
    );
  const [row] = await db
    .insert(M)
    .values(mapValues(serverId, profileId, baseMapSha256))
    .returning({ id: M.id });
  if (!row) throw new Error('Map fixture insert returned no row');
  return row.id;
}
