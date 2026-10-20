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
