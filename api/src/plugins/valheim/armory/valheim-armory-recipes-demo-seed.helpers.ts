/**
 * ROK-1854 L5 — DEMO_MODE recipes fixture writes, all through the REAL
 * importers on stored snapshot rows (`imported`, so the drain never
 * re-applies them): the recipes set (`importRecipes`), the containers scan
 * with the copper chest added (`importContainers`, same world as the 1853
 * seed, which it replaces — a scan is latest-wins per world), and the
 * catalogue names merged into the armory fixture catalogue.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ValheimContainersMessage,
  ValheimRecipesMessage,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import type { ArmorySnapshot } from './valheim-armory.mappers';
import {
  containerPublicKey,
  importContainers,
} from './valheim-armory-containers.import';
import { ARMORY_FIXTURE_GAME_VERSION } from './valheim-armory-demo-seed.helpers';
import { importRecipes } from './valheim-armory-recipes.import';
import {
  DEMO_COPPER_CHEST,
  RECIPES_DEMO_ITEMS,
  RECIPES_DEMO_MESSAGE as RECIPES,
  RECIPES_DEMO_STOCK as STOCK,
} from './valheim-armory-recipes-demo-fixture';

type Db = PostgresJsDatabase<typeof schema>;
type DemoMessage = ValheimRecipesMessage | ValheimContainersMessage;

/** What the fixture seeds — counts straight from the imported messages. */
export const RECIPES_DEMO_COUNTS = {
  recipes: RECIPES.recipes.length,
  processors: RECIPES.processors.length,
  processes: RECIPES.processes.length,
  catalogueItems: Object.keys(RECIPES_DEMO_ITEMS).length,
  containers: STOCK.containers.length,
};

export const DEMO_COPPER_CHEST_KEY = containerPublicKey(
  STOCK.worldUid,
  DEMO_COPPER_CHEST,
);

const worldOf = (msg: DemoMessage): string | null =>
  msg.kind === 'containers' ? msg.worldUid : null;

function snapshotValues(
  serverId: number,
  msg: DemoMessage,
  snapshotKey: string,
): schema.NewValheimLinkSnapshot {
  return {
    pelicanServerId: serverId,
    kind: msg.kind,
    snapshotKey,
    steamId: null,
    playerId: null,
    worldUid: worldOf(msg),
    gameVersion: msg.gameVersion,
    modVersion: msg.modVersion,
    capturedAt: new Date(msg.capturedAt),
    payload: msg,
    status: 'imported',
    statusDetail: null,
  };
}

/** Upsert the stored snapshot row a live upload would have left behind. */
async function storeSnapshot(
  tx: ValheimLinkTx,
  serverId: number,
  msg: DemoMessage,
  snapshotKey: string,
): Promise<ArmorySnapshot> {
  const S = schema.valheimLinkSnapshots;
  const values = snapshotValues(serverId, msg, snapshotKey);
  const [snap] = await tx
    .insert(S)
    .values(values)
    .onConflictDoUpdate({
      target: [S.pelicanServerId, S.kind, S.snapshotKey],
      set: { ...values, receivedAt: new Date() },
    })
    .returning({ id: S.id, receivedAt: S.receivedAt });
  if (!snap) throw new Error(`recipes fixture: no ${msg.kind} snapshot row`);
  return {
    id: snap.id,
    pelicanServerId: serverId,
    kind: msg.kind,
    steamId: null,
    playerId: null,
    worldUid: worldOf(msg),
    receivedAt: snap.receivedAt.toISOString(),
    payload: msg,
  };
}

/** Reset the fixture world's scan and re-import it with the copper chest. */
export async function importRecipesDemoStock(
  db: Db,
  serverId: number,
): Promise<void> {
  const scans = schema.valheimContainerScans;
  await db.transaction(async (tx) => {
    await tx
      .delete(scans)
      .where(
        and(
          eq(scans.pelicanServerId, serverId),
          eq(scans.worldUid, STOCK.worldUid),
        ),
      );
    const key = `demo-containers:${STOCK.worldUid}`;
    const snap = await storeSnapshot(tx, serverId, STOCK, key);
    if (!(await importContainers(tx, snap, STOCK))) {
      throw new Error('recipes fixture: stock import skipped as stale');
    }
  });
}

/** Import the recipes set (equal `capturedAt` rewrites it — idempotent). */
export async function importRecipesDemoSet(
  db: Db,
  serverId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const key = `demo-recipes:${RECIPES.gameVersion}`;
    const snap = await storeSnapshot(tx, serverId, RECIPES, key);
    if (!(await importRecipes(tx, snap, RECIPES))) {
      throw new Error('recipes fixture: a newer recipe set is stored');
    }
  });
}

/** Merge the Bronze-chain names into the server's fixture catalogue. */
export async function mergeRecipesDemoCatalog(
  db: Db,
  serverId: number,
): Promise<void> {
  const C = schema.valheimItemCatalogs;
  const rows = await db
    .update(C)
    .set({
      items: sql`${C.items} || ${JSON.stringify(RECIPES_DEMO_ITEMS)}::jsonb`,
    })
    .where(
      and(
        eq(C.pelicanServerId, serverId),
        eq(C.gameVersion, ARMORY_FIXTURE_GAME_VERSION),
      ),
    )
    .returning({ id: C.id });
  if (rows.length === 0) throw new Error('recipes fixture: no catalogue row');
}

/**
 * Every prefab the demo set lists: recipe results, pieces, stations and
 * processors (contract form). ROK-1948: the unclaimed scout knows all of it,
 * so under server-wide spoiler protection nothing is hidden by default.
 */
export const RECIPES_DEMO_ALL_KNOWN: readonly string[] = [
  ...new Set([
    ...RECIPES.recipes.map((r) => r.result),
    ...RECIPES.pieces.map((p) => p.prefab),
    ...RECIPES.stations.map((s) => s.prefab),
    ...RECIPES.processors.map((p) => p.prefab),
  ]),
];

/**
 * Every item the demo set's processes consume (ores, scrap, Wood, raw meat).
 * ROK-1948 R4 shows a processor's output only when its input is a known item
 * or a discovered recipe uses the output — Cooked meat needs Raw meat here.
 */
export const RECIPES_DEMO_ALL_KNOWN_ITEMS: readonly string[] = [
  ...new Set(RECIPES.processes.flatMap((p) => p.inputs.map((i) => i.prefab))),
];

/**
 * ROK-1862 — what the owner's claimed character (`c1`) has learned: every
 * prefab the demo set lists EXCEPT Bronze sword (contract form: result
 * prefabs), so the Planner shows Club known and Bronze sword "Not discovered
 * yet". The unclaimed member stays the "no character" case.
 */
export const RECIPES_DEMO_UNDISCOVERED = 'SwordBronze';
export const RECIPES_DEMO_OWNER_KNOWN: readonly string[] =
  RECIPES_DEMO_ALL_KNOWN.filter((p) => p !== RECIPES_DEMO_UNDISCOVERED);

/** Write the owner's known list onto every profile it claims on the server. */
export async function setRecipesDemoOwnerKnowledge(
  db: Db,
  serverId: number,
  ownerUserId: number,
): Promise<void> {
  const P = schema.valheimProfiles;
  const rows = await db
    .update(P)
    .set({
      knownRecipes: [...RECIPES_DEMO_OWNER_KNOWN],
      importedAt: sql`now()`,
    })
    .where(and(eq(P.pelicanServerId, serverId), eq(P.claimedBy, ownerUserId)))
    .returning({ id: P.id });
  if (rows.length === 0) throw new Error('recipes fixture: no owner profile');
}
