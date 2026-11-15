import type {
  AddonLootExport,
  AddonLootImportSummary,
} from '@raid-ledger/contract';
import type {
  AddonApplyContext,
  AddonSectionOutcome,
} from './addon-import-apply.types';

/**
 * ROK-2184 — the v2 `loot` section's preview/apply step, called from
 * `runSection` (`addon-import.service.helpers.ts`) inside the import's ONE
 * transaction (`ctx.tx`), after the binding passed. `payload` is already
 * strict-schema-validated, clock-bounded and sanitised by the decoder (each
 * drop's raw `link` kept verbatim).
 *
 * Contract: `dryRun` → reads only, `status: 'preview'`; otherwise writes in
 * `ctx.tx` and returns `applied` (≥ 1 new drop) or `noop` (all duplicates).
 * `summary.drops` = drops in the payload; `newDrops + duplicateDrops = drops`.
 *
 * // L3: STUB — the storage lane replaces this body with the de-duplicated
 * // insert into `guild_loot_drops` (dedup key, ruling Q5: guild,
 * // looterGuid ?? looterName, itemId, quantity, floor(at / 120), instanceId),
 * // mirroring `addon-import-raid.apply.ts`. Until then nothing is stored:
 * // `newDrops: 0`, every drop counted as a duplicate, `status: 'noop'`.
 */
export function applyLootImport(
  ctx: AddonApplyContext,
  payload: AddonLootExport,
  dryRun: boolean,
): Promise<AddonSectionOutcome<AddonLootImportSummary>> {
  void ctx;
  const { drops, windowStart, windowEnd } = payload.data;
  const summary: AddonLootImportSummary = {
    drops: drops.length,
    newDrops: 0,
    duplicateDrops: drops.length,
    windowStart,
    windowEnd,
  };
  return Promise.resolve({ status: dryRun ? 'preview' : 'noop', summary });
}
