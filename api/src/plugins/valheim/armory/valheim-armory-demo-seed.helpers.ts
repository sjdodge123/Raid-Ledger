/**
 * ROK-1836 D8 — DEMO_MODE armory fixture writes: the server's catalogue +
 * atlas (and a modded file icon), and one keyed character (`c1`…`c3`, see
 * `valheim-armory-demo-sheet.ts`). The catalogue covers SwordIron,
 * HelmetBronze, Wood, TrophyBoar and the modded blade; the sheet also
 * references CookedMeat + TrophyEikthyr so the prefab fallback (D7) has
 * something to show.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type {
  NewValheimProfile,
  ValheimItemCatalogEntryRow,
} from '../../../drizzle/schema';
import {
  blobRelativePath,
  blobTempPath,
  commitBlob,
  discardBlob,
} from '../link/blobs/valheim-link-blob.store';
import { encodeDemoPng, type PixelFn } from './valheim-armory-demo-png';
import {
  ARMORY_FIXTURE_IDENTITIES,
  ARMORY_FIXTURE_MOD_PREFAB,
  fixtureSheet,
  type ArmoryFixtureKey,
} from './valheim-armory-demo-sheet';

type Db = PostgresJsDatabase<typeof schema>;

export const ARMORY_FIXTURE_GAME_VERSION = '0.220.5';
const ATLAS_W = 256;
const ATLAS_H = 64;
const COLOURS: [number, number, number][] = [
  [176, 182, 196],
  [205, 127, 50],
  [133, 94, 66],
  [120, 72, 40],
];

/** Request: `{ slot?, key?, claimedBy?, withCatalog?, extraRows? }`. */
export interface ArmoryCharacterFixtureRequest {
  slot: number;
  key: ArmoryFixtureKey;
  claimedBy: number | null;
  withCatalog: boolean;
  extraRows: boolean;
}

const atlasEntry = (
  name: string,
  category: string,
  cell: number,
): ValheimItemCatalogEntryRow => ({
  name,
  category,
  maxStack: 1,
  maxQuality: 4,
  variants: 0,
  icon: { kind: 'atlas', x: cell * 64, y: 0, w: 64, h: 64 },
});

function fixtureItems(
  modIconSha256: string,
): Record<string, ValheimItemCatalogEntryRow> {
  return {
    SwordIron: atlasEntry('Iron sword', 'OneHandedWeapon', 0),
    HelmetBronze: atlasEntry('Bronze helmet', 'Helmet', 1),
    Wood: atlasEntry('Wood', 'Material', 2),
    TrophyBoar: atlasEntry('Boar trophy', 'Trophy', 3),
    [ARMORY_FIXTURE_MOD_PREFAB]: {
      name: 'Mythic blade',
      category: 'OneHandedWeapon',
      maxStack: 1,
      maxQuality: 4,
      variants: 0,
      icon: { kind: 'file', file: 'RtDMythicBlade.png', sha256: modIconSha256 },
    },
  };
}

const atlasPixel: PixelFn = (x) => COLOURS[Math.floor(x / 64)] ?? [0, 0, 0];
const modIconPixel: PixelFn = () => [148, 0, 211];

/** Temp file + rename — a concurrent blob read never sees a short file. */
async function writeBlobAtomically(
  serverId: number,
  rel: string,
  bytes: Buffer,
): Promise<void> {
  const tmp = await blobTempPath(serverId);
  try {
    await writeFile(tmp, bytes); // never truncate the served file in place
    await commitBlob(tmp, rel);
  } catch (err) {
    await discardBlob(tmp);
    throw err;
  }
}

/** Write a PNG + its blob row (idempotent); returns its sha256. */
async function storePng(
  db: Db,
  serverId: number,
  [w, h]: [number, number],
  pixel: PixelFn,
): Promise<string> {
  const bytes = encodeDemoPng(w, h, pixel);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const rel = blobRelativePath(serverId, sha256);
  await writeBlobAtomically(serverId, rel, bytes);
  await db
    .insert(schema.valheimLinkBlobs)
    .values({
      pelicanServerId: serverId,
      sha256,
      byteLength: bytes.length,
      contentType: 'image/png',
      width: w,
      height: h,
      storagePath: rel,
    })
    .onConflictDoNothing();
  return sha256;
}

async function insertCatalog(db: Db, serverId: number): Promise<void> {
  const atlasSha256 = await storePng(
    db,
    serverId,
    [ATLAS_W, ATLAS_H],
    atlasPixel,
  );
  const modSha256 = await storePng(db, serverId, [64, 64], modIconPixel);
  await db.insert(schema.valheimItemCatalogs).values({
    pelicanServerId: serverId,
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    locale: 'English',
    atlasSha256,
    atlasWidth: ATLAS_W,
    atlasHeight: ATLAS_H,
    items: fixtureItems(modSha256),
    capturedAt: new Date(),
  });
}

/** Drop the server's fixture catalogue (shared by every key). */
async function resetCatalog(db: Db, serverId: number): Promise<void> {
  const C = schema.valheimItemCatalogs;
  await db
    .delete(C)
    .where(
      and(
        eq(C.pelicanServerId, serverId),
        eq(C.gameVersion, ARMORY_FIXTURE_GAME_VERSION),
      ),
    );
}

/** Drop ONLY this key's profile — the other keys' characters survive. */
async function resetProfile(
  db: Db,
  serverId: number,
  key: ArmoryFixtureKey,
): Promise<void> {
  const P = schema.valheimProfiles;
  const { steamId, playerId } = ARMORY_FIXTURE_IDENTITIES[key];
  await db
    .delete(P)
    .where(
      and(
        eq(P.pelicanServerId, serverId),
        eq(P.steamId, steamId),
        eq(P.playerId, playerId),
      ),
    );
}

function profileValues(
  serverId: number,
  req: ArmoryCharacterFixtureRequest,
): NewValheimProfile {
  const { claimedBy } = req;
  return {
    pelicanServerId: serverId,
    ...ARMORY_FIXTURE_IDENTITIES[req.key],
    worldUid: '1234567890123',
    worldName: 'Fixtureheim',
    claimedBy,
    claimSource: claimedBy === null ? null : 'admin',
    claimedAt: claimedBy === null ? null : new Date(),
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    modVersion: '1.0.0',
    capturedAt: new Date(),
    ...fixtureSheet(req.extraRows),
    knownItems: [],
    knownRecipes: [],
  };
}

/**
 * Reset `req.key`'s character (idempotent per key) and the server's
 * fixture catalogue (re-inserted with its atlas when `withCatalog`, so the
 * last call decides it for every key); returns the profile id.
 */
export async function seedArmoryCharacter(
  db: Db,
  serverId: number,
  req: ArmoryCharacterFixtureRequest,
): Promise<number> {
  await resetCatalog(db, serverId);
  if (req.withCatalog) await insertCatalog(db, serverId);
  return seedArmoryProfile(db, serverId, req);
}

/** Insert the fixture catalogue only when the server has none (no reset). */
export async function ensureArmoryCatalog(
  db: Db,
  serverId: number,
): Promise<void> {
  const C = schema.valheimItemCatalogs;
  const [found] = await db
    .select({ id: C.id })
    .from(C)
    .where(
      and(
        eq(C.pelicanServerId, serverId),
        eq(C.gameVersion, ARMORY_FIXTURE_GAME_VERSION),
      ),
    )
    .limit(1);
  if (!found) await insertCatalog(db, serverId);
}

/**
 * Reset ONLY `req.key`'s character (the catalogue is untouched; `req`'s
 * `withCatalog` is ignored here) and return its new profile id.
 */
export async function seedArmoryProfile(
  db: Db,
  serverId: number,
  req: ArmoryCharacterFixtureRequest,
): Promise<number> {
  await resetProfile(db, serverId, req.key);
  const P = schema.valheimProfiles;
  const [row] = await db
    .insert(P)
    .values(profileValues(serverId, req))
    .returning({ id: P.id });
  if (!row) throw new Error('Armory fixture insert returned no row');
  return row.id;
}
