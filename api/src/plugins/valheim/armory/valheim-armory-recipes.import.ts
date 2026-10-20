/**
 * ROK-1854 L2 — imports one re-validated `recipes` snapshot (D4): upsert the
 * set (latest `captured_at` wins), clear its children, bulk-insert the new
 * ones. Everything runs on the handed-in transaction; a failing statement
 * aborts it whole, so nothing here catches and retries. A missing atlas blob
 * is fine — rows import and icons resolve once the PNG lands.
 */
import type { ValheimRecipesMessage } from '@raid-ledger/contract';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import type { ArmorySnapshot } from './valheim-armory.mappers';
import {
  toPieceRows,
  toProcessorRows,
  toProcessRows,
  toRecipeRows,
  toRecipeSetValues,
  toStationRows,
} from './valheim-recipes.mappers';
import {
  clearRecipeSet,
  insertRecipeSetChildren,
  upsertRecipeSet,
} from './valheim-recipes.repository';

/** Returns false when a newer set is already stored (→ `skipped_stale`). */
export async function importRecipes(
  tx: ValheimLinkTx,
  snap: ArmorySnapshot,
  msg: ValheimRecipesMessage,
): Promise<boolean> {
  const set = await upsertRecipeSet(tx, toRecipeSetValues(snap, msg));
  if (!set) return false;
  await clearRecipeSet(tx, set.id);
  await insertRecipeSetChildren(tx, {
    stations: toStationRows(set.id, msg),
    recipes: toRecipeRows(set.id, msg),
    pieces: toPieceRows(set.id, msg),
    processors: toProcessorRows(set.id, msg),
    processes: toProcessRows(set.id, msg),
  });
  return true;
}
