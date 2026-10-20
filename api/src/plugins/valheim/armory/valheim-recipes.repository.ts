/**
 * ROK-1854 L2 — recipe-set storage. Latest wins per (server, gameVersion)
 * exactly like the items catalogue (D4): the set row is upserted in place and
 * its five child tables are cleared and bulk-inserted inside the importer's
 * one transaction. Reads load a whole set for the in-memory graph (D5).
 */
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';

type Db = PostgresJsDatabase<typeof schema>;
/** A pool handle or the importer's transaction. */
export type RecipesExec = Db | ValheimLinkTx;

const {
  valheimRecipeSets: sets,
  valheimRecipeStations: stations,
  valheimRecipes: recipes,
  valheimPieces: pieces,
  valheimProcessors: processors,
  valheimProcesses: processes,
} = schema;

/** Rows per INSERT; widest table is 13 params → 13 000 binds < 65 535. */
export const RECIPE_INSERT_CHUNK = 1000;

/** The five child row arrays of one set, for insert. */
export interface NewRecipeSetChildren {
  stations: schema.NewValheimRecipeStation[];
  recipes: schema.NewValheimRecipe[];
  pieces: schema.NewValheimPiece[];
  processors: schema.NewValheimProcessor[];
  processes: schema.NewValheimProcess[];
}

/** The five child row arrays of one set, as read. */
export interface RecipeSetRows {
  stations: schema.ValheimRecipeStationRow[];
  recipes: schema.ValheimRecipeRow[];
  pieces: schema.ValheimPieceRow[];
  processors: schema.ValheimProcessorRow[];
  processes: schema.ValheimProcessRow[];
}

/** Replaced on re-import (identity columns stay). */
const SET_COLUMNS = {
  locale: sets.locale,
  capturedAt: sets.capturedAt,
  atlasSha256: sets.atlasSha256,
  atlasWidth: sets.atlasWidth,
  atlasHeight: sets.atlasHeight,
  sourceSnapshotId: sets.sourceSnapshotId,
};

/** `{ key: excluded."<column>" }` for an ON CONFLICT DO UPDATE set. */
const fromExcluded = (cols: Record<string, { name: string }>) =>
  Object.fromEntries(
    Object.entries(cols).map(([k, c]) => [k, sql.raw(`excluded."${c.name}"`)]),
  );

/**
 * D4 upsert. Equal `captured_at` rewrites identical data (idempotent, as
 * `upsertCatalog`); returns null when the stored set is strictly newer.
 * Every accepted write bumps `imported_at` — the graph-cache revision.
 */
export async function upsertRecipeSet(
  tx: ValheimLinkTx,
  values: schema.NewValheimRecipeSet,
): Promise<schema.ValheimRecipeSetRow | null> {
  const [row] = await tx
    .insert(sets)
    .values(values)
    .onConflictDoUpdate({
      target: [sets.pelicanServerId, sets.gameVersion],
      set: {
        ...fromExcluded(SET_COLUMNS),
        // Strictly increasing on every write (≥ 1 ms): the read side keys
        // its graph cache on it, so even an equal-`capturedAt` rewrite
        // inside the same millisecond must change it (ROK-1854 review).
        importedAt: sql`GREATEST(now(), ${sets.importedAt} + interval '1 millisecond')`,
      },
      setWhere: sql`${sets.capturedAt} <= excluded.captured_at`,
    })
    .returning();
  return row ?? null;
}

/** Deletes every child row of a set (the set row itself is kept). */
export async function clearRecipeSet(
  tx: ValheimLinkTx,
  setId: number,
): Promise<void> {
  await tx.delete(stations).where(eq(stations.setId, setId));
  await tx.delete(recipes).where(eq(recipes.setId, setId));
  await tx.delete(pieces).where(eq(pieces.setId, setId));
  await tx.delete(processors).where(eq(processors.setId, setId));
  await tx.delete(processes).where(eq(processes.setId, setId));
}

/** Runs `write` once per chunk of at most RECIPE_INSERT_CHUNK rows. */
async function inChunks<T>(
  rows: readonly T[],
  write: (chunk: T[]) => PromiseLike<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += RECIPE_INSERT_CHUNK) {
    await write(rows.slice(i, i + RECIPE_INSERT_CHUNK));
  }
}

/** Bulk-inserts a set's children, sequentially on the one transaction. */
export async function insertRecipeSetChildren(
  tx: ValheimLinkTx,
  rows: NewRecipeSetChildren,
): Promise<void> {
  await inChunks(rows.stations, (c) => tx.insert(stations).values(c));
  await inChunks(rows.recipes, (c) => tx.insert(recipes).values(c));
  await inChunks(rows.pieces, (c) => tx.insert(pieces).values(c));
  await inChunks(rows.processors, (c) => tx.insert(processors).values(c));
  await inChunks(rows.processes, (c) => tx.insert(processes).values(c));
}

/** D6: the server's set with the latest `captured_at` (id breaks ties). */
export async function findLatestRecipeSet(
  db: RecipesExec,
  serverId: number,
): Promise<schema.ValheimRecipeSetRow | null> {
  const [row] = await db
    .select()
    .from(sets)
    .where(eq(sets.pelicanServerId, serverId))
    .orderBy(desc(sets.capturedAt), desc(sets.id))
    .limit(1);
  return row ?? null;
}

/** Stations, recipes and pieces of one set, in key order. */
async function loadCraftRows(db: RecipesExec, setId: number) {
  const [st, rc, pc] = await Promise.all([
    db
      .select()
      .from(stations)
      .where(eq(stations.setId, setId))
      .orderBy(asc(stations.prefab)),
    db
      .select()
      .from(recipes)
      .where(eq(recipes.setId, setId))
      .orderBy(asc(recipes.recipeId)),
    db
      .select()
      .from(pieces)
      .where(eq(pieces.setId, setId))
      .orderBy(asc(pieces.prefab)),
  ]);
  return { stations: st, recipes: rc, pieces: pc };
}

/** Processors (prefab order) and processes (wire order) of one set. */
async function loadProcessRows(db: RecipesExec, setId: number) {
  const [pr, ps] = await Promise.all([
    db
      .select()
      .from(processors)
      .where(eq(processors.setId, setId))
      .orderBy(asc(processors.prefab)),
    db
      .select()
      .from(processes)
      .where(eq(processes.setId, setId))
      .orderBy(asc(processes.ord)),
  ]);
  return { processors: pr, processes: ps };
}

/** All child rows of one set, in deterministic key order. */
export async function loadRecipeSetRows(
  db: RecipesExec,
  setId: number,
): Promise<RecipeSetRows> {
  const [craft, process] = await Promise.all([
    loadCraftRows(db, setId),
    loadProcessRows(db, setId),
  ]);
  return { ...craft, ...process };
}
