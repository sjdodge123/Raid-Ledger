/**
 * ROK-1836 D8 — DEMO_MODE armory character fixture data (anonymised, from
 * the `packages/contract/valheim-link/v1/fixtures/character-vanilla` shape;
 * inlined because the runtime image does not ship the contract fixtures).
 * The catalogue covers SwordIron, HelmetBronze, Wood and TrophyBoar; the
 * sheet also references CookedMeat + TrophyEikthyr so the prefab fallback
 * (D7) has something to show.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type {
  NewValheimProfile,
  ValheimItemCatalogEntryRow,
} from '../../../drizzle/schema';
import {
  blobAbsolutePath,
  blobRelativePath,
} from '../link/blobs/valheim-link-blob.store';
import { encodeDemoPng, type PixelFn } from './valheim-armory-demo-png';

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

/** Request: `{ slot?, claimedBy?, withCatalog? }`. */
export interface ArmoryCharacterFixtureRequest {
  slot: number;
  claimedBy: number | null;
  withCatalog: boolean;
}

const weapon = (prefab: string, quality: number, dur: number, max: number) => ({
  prefab,
  stack: 1,
  quality,
  variant: 0,
  durability: dur,
  maxDurability: max,
});
const stack = (prefab: string, n: number) => ({
  prefab,
  stack: n,
  quality: 1,
  variant: 0,
  durability: null,
  maxDurability: null,
});

/** The sheet columns of the fixture profile. */
function fixtureSheet(): Pick<
  NewValheimProfile,
  'equipment' | 'inventory' | 'skills' | 'trophies'
> {
  const sword = weapon('SwordIron', 3, 180.5, 250);
  const helmet = weapon('HelmetBronze', 2, 300, 400);
  return {
    equipment: [
      { slot: 'rightHand', item: sword },
      { slot: 'head', item: helmet },
    ],
    inventory: {
      grid: { width: 8, height: 4, extraRows: [] },
      items: [
        { x: 0, y: 0, equipped: true, item: sword },
        { x: 1, y: 0, equipped: true, item: helmet },
        { x: 2, y: 0, equipped: false, item: stack('Wood', 50) },
        { x: 7, y: 3, equipped: false, item: stack('CookedMeat', 12) },
      ],
    },
    skills: [
      { id: 'Swords', level: 34.25, accumulator: 12.5 },
      { id: 'Run', level: 41, accumulator: 0 },
      { id: '-1287461328', level: 3.5, accumulator: 1.75 },
    ],
    trophies: ['TrophyBoar', 'TrophyEikthyr'],
  };
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

const FIXTURE_ITEMS: Record<string, ValheimItemCatalogEntryRow> = {
  SwordIron: atlasEntry('Iron sword', 'OneHandedWeapon', 0),
  HelmetBronze: atlasEntry('Bronze helmet', 'Helmet', 1),
  Wood: atlasEntry('Wood', 'Material', 2),
  TrophyBoar: atlasEntry('Boar trophy', 'Trophy', 3),
};

const atlasPixel: PixelFn = (x) => COLOURS[Math.floor(x / 64)] ?? [0, 0, 0];

/** Write the atlas PNG + its blob row (idempotent); returns its sha256. */
async function storeAtlas(db: Db, serverId: number): Promise<string> {
  const bytes = encodeDemoPng(ATLAS_W, ATLAS_H, atlasPixel);
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
      width: ATLAS_W,
      height: ATLAS_H,
      storagePath: rel,
    })
    .onConflictDoNothing();
  return sha256;
}

async function insertCatalog(db: Db, serverId: number): Promise<void> {
  const atlasSha256 = await storeAtlas(db, serverId);
  await db.insert(schema.valheimItemCatalogs).values({
    pelicanServerId: serverId,
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    locale: 'English',
    atlasSha256,
    atlasWidth: ATLAS_W,
    atlasHeight: ATLAS_H,
    items: FIXTURE_ITEMS,
    capturedAt: new Date(),
  });
}

/** Drop the server's fixture profile + catalogue (idempotent re-run). */
async function resetArmoryRows(db: Db, serverId: number): Promise<void> {
  const P = schema.valheimProfiles;
  const C = schema.valheimItemCatalogs;
  await db.delete(P).where(eq(P.pelicanServerId, serverId));
  await db
    .delete(C)
    .where(
      and(
        eq(C.pelicanServerId, serverId),
        eq(C.gameVersion, ARMORY_FIXTURE_GAME_VERSION),
      ),
    );
}

function profileValues(
  serverId: number,
  claimedBy: number | null,
): NewValheimProfile {
  return {
    pelicanServerId: serverId,
    steamId: '76561198000000001',
    playerId: '1000000000000001',
    worldUid: '1234567890123',
    worldName: 'Fixtureheim',
    name: 'Testviking',
    claimedBy,
    claimSource: claimedBy === null ? null : 'admin',
    claimedAt: claimedBy === null ? null : new Date(),
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    modVersion: '1.0.0',
    capturedAt: new Date(),
    ...fixtureSheet(),
    knownItems: [],
    knownRecipes: [],
  };
}

/**
 * Reset the server's armory rows to one fixture character (+ catalogue
 * and atlas when `withCatalog`); returns the profile id.
 */
export async function seedArmoryCharacter(
  db: Db,
  serverId: number,
  req: ArmoryCharacterFixtureRequest,
): Promise<number> {
  await resetArmoryRows(db, serverId);
  if (req.withCatalog) await insertCatalog(db, serverId);
  const P = schema.valheimProfiles;
  const [row] = await db
    .insert(P)
    .values(profileValues(serverId, req.claimedBy))
    .returning({ id: P.id });
  if (!row) throw new Error('Armory fixture insert returned no row');
  return row.id;
}
