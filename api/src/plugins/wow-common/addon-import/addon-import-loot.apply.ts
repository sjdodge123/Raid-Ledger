import { and, between, eq } from 'drizzle-orm';
import type {
  AddonLootExport,
  AddonLootImportSummary,
} from '@raid-ledger/contract';
import { guildLootDrops } from '../../../drizzle/schema';
import {
  guildNameKey,
  type AddonApplyContext,
  type AddonSectionOutcome,
} from './addon-import-apply.types';
import { assertLootExporterInGuild } from './addon-import-loot.guild';
import {
  countNewDrops,
  lootAtBucket,
  lootDropRows,
  lootKeyString,
} from './addon-import-loot.keys';

/**
 * ROK-2184 — the v2 `loot` section's preview/apply step, called from
 * `runSection` (`addon-import.service.helpers.ts`) inside the import's ONE
 * transaction (`ctx.tx`), after the binding passed. `payload` is already
 * strict-schema-validated, clock-bounded and sanitised by the decoder. Loot
 * outside a group never reaches the payload (ruling Q10), so nothing is
 * re-filtered here.
 *
 * Mirrors `addon-import-raid.apply.ts`: drops are shared rows de-duplicated
 * across exporters on ruling Q5's key (`uq_guild_loot_drops_dedupe`) with
 * `ON CONFLICT DO NOTHING`; `RETURNING` counts genuine inserts. Two exporters
 * of one guild are also serialised on the guild-import lock, which
 * `lockImportScope` takes for the loot section's guild key before any
 * section runs (apply only — previews take no lock).
 *
 * Both paths first require the exporter on the guild's roster
 * (`assertLootExporterInGuild` → `NOT_IN_GUILD`); unguilded loot skips it.
 * Rows insert in `lootKeyString` order, so two concurrent unguilded imports
 * (no guild lock) lock overlapping keys in one order and cannot deadlock.
 *
 * Contract: `dryRun` → reads only, `status: 'preview'`; otherwise writes in
 * `ctx.tx` and returns `applied` (≥ 1 new drop) or `noop` (all duplicates).
 * `summary.drops` = drops in the payload; `newDrops + duplicateDrops = drops`.
 */

type LootOutcome = AddonSectionOutcome<AddonLootImportSummary>;

export function buildLootSummary(
  payload: AddonLootExport,
  newDrops: number,
): AddonLootImportSummary {
  const { drops, windowStart, windowEnd } = payload.data;
  return {
    drops: drops.length,
    newDrops,
    duplicateDrops: drops.length - newDrops,
    windowStart,
    windowEnd,
  };
}

/** Dedup keys already stored for this guild inside the payload's buckets. */
async function storedKeys(
  ctx: AddonApplyContext,
  payload: AddonLootExport,
): Promise<Set<string>> {
  const buckets = payload.data.drops.map((d) => lootAtBucket(d.at));
  const g = guildLootDrops;
  const rows = await ctx.tx
    .select({
      looterKey: g.looterKey,
      itemId: g.itemId,
      quantity: g.quantity,
      atBucket: g.atBucket,
      instanceId: g.instanceId,
    })
    .from(g)
    .where(
      and(
        eq(g.gameId, ctx.gameId),
        eq(g.region, ctx.region),
        eq(g.guildKey, guildNameKey(payload.who.guildName)),
        between(g.atBucket, Math.min(...buckets), Math.max(...buckets)),
      ),
    );
  return new Set(rows.map(lootKeyString));
}

/** Dry run: how many drops would be new vs already reported. No writes. */
async function previewLoot(
  ctx: AddonApplyContext,
  payload: AddonLootExport,
): Promise<LootOutcome> {
  await assertLootExporterInGuild(ctx, payload);
  const { drops } = payload.data;
  const fresh =
    drops.length === 0
      ? 0
      : countNewDrops(drops, await storedKeys(ctx, payload));
  return { status: 'preview', summary: buildLootSummary(payload, fresh) };
}

/** Insert every drop, skipping stored ones; `newDrops` = genuine inserts. */
async function applyLoot(
  ctx: AddonApplyContext,
  payload: AddonLootExport,
): Promise<LootOutcome> {
  await assertLootExporterInGuild(ctx, payload);
  const { drops } = payload.data;
  if (drops.length === 0) {
    return { status: 'noop', summary: buildLootSummary(payload, 0) };
  }
  const inserted = await ctx.tx
    .insert(guildLootDrops)
    .values(lootDropRows(drops, payload, ctx))
    .onConflictDoNothing()
    .returning({ id: guildLootDrops.id });
  return {
    status: inserted.length > 0 ? 'applied' : 'noop',
    summary: buildLootSummary(payload, inserted.length),
  };
}

export function applyLootImport(
  ctx: AddonApplyContext,
  payload: AddonLootExport,
  dryRun: boolean,
): Promise<LootOutcome> {
  return dryRun ? previewLoot(ctx, payload) : applyLoot(ctx, payload);
}
