import { and, eq } from 'drizzle-orm';
import type {
  AddonCharSnapshotData,
  AddonCharImportSummarySchema,
} from '@raid-ledger/contract';
import type { z } from 'zod';
import { characterAddonSnapshots } from '../../../drizzle/schema';
import type { DecodedAddonCharExport } from './addon-import.decoder';
import {
  fromUnix,
  type AddonApplyContext,
  type AddonSectionOutcome,
} from './addon-import-apply.types';

/** ROK-1724 §4.3 Apply — section `char`: one snapshot row per character. */

export type AddonCharSummary = z.infer<typeof AddonCharImportSummarySchema>;
type CharOutcome = AddonSectionOutcome<AddonCharSummary>;

/** What the stored snapshot says about this export. */
export type CharWriteDecision = 'noop' | 'stale' | 'write';

export interface StoredCharSnapshot {
  payloadSha256: string;
  capturedAt: Date;
}

export function buildCharSummary(
  data: AddonCharSnapshotData,
): AddonCharSummary {
  const ilvls = data.gear
    .map((g) => g.ilvl)
    .filter((v): v is number => typeof v === 'number');
  const avg = ilvls.length
    ? Math.round((ilvls.reduce((a, b) => a + b, 0) / ilvls.length) * 10) / 10
    : null;
  return {
    gearCount: data.gear.length,
    avgIlvl: avg,
    talentNodes: data.talents.nodes.length,
    lockouts: data.lockouts.length,
  };
}

/** Same sha256 → noop; `exportedAt` older than `captured_at` → stale. */
export function decideCharWrite(
  stored: StoredCharSnapshot | undefined,
  sha256: string,
  exportedAt: number,
): CharWriteDecision {
  if (!stored) return 'write';
  if (stored.payloadSha256 === sha256) return 'noop';
  if (fromUnix(exportedAt).getTime() < stored.capturedAt.getTime()) {
    return 'stale';
  }
  return 'write';
}

async function loadStored(
  ctx: AddonApplyContext,
): Promise<StoredCharSnapshot | undefined> {
  const [row] = await ctx.tx
    .select({
      payloadSha256: characterAddonSnapshots.payloadSha256,
      capturedAt: characterAddonSnapshots.capturedAt,
    })
    .from(characterAddonSnapshots)
    .where(
      and(
        eq(characterAddonSnapshots.characterId, ctx.characterId),
        eq(characterAddonSnapshots.section, 'char'),
      ),
    );
  return row;
}

/** Dry run: reads only. `noop`/`stale` surface early so the UI can say so. */
export async function previewChar(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<CharOutcome> {
  const decision = decideCharWrite(
    await loadStored(ctx),
    ctx.sha256,
    payload.exportedAt,
  );
  const status = decision === 'write' ? 'preview' : decision;
  return { status, summary: buildCharSummary(payload.data) };
}

/** Upsert the snapshot unless noop/stale. Writes only the importer's char. */
export async function applyChar(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<CharOutcome> {
  const summary = buildCharSummary(payload.data);
  const decision = decideCharWrite(
    await loadStored(ctx),
    ctx.sha256,
    payload.exportedAt,
  );
  if (decision !== 'write') return { status: decision, summary };
  const values = {
    schema: payload.schema,
    data: payload.data,
    capturedAt: fromUnix(payload.exportedAt),
    importedAt: new Date(),
    payloadSha256: ctx.sha256,
  };
  await ctx.tx
    .insert(characterAddonSnapshots)
    .values({ characterId: ctx.characterId, section: 'char', ...values })
    .onConflictDoUpdate({
      target: [
        characterAddonSnapshots.characterId,
        characterAddonSnapshots.section,
      ],
      set: values,
    });
  return { status: 'applied', summary };
}
