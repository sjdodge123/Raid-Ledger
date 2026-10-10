import { and, eq, sql } from 'drizzle-orm';
import {
  ADDON_CHAR_SNAPSHOT_SCHEMA,
  type AddonCharSnapshotData,
  type AddonCharImportSummarySchema,
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

/**
 * When the guarded upsert updated nothing, a concurrent apply won the row
 * between our pre-read and our write: the same export → noop, anything else
 * (a newer snapshot, or an equal one with another sha) → stale.
 */
export function decideLostRace(
  stored: StoredCharSnapshot | undefined,
  sha256: string,
): 'noop' | 'stale' {
  return stored?.payloadSha256 === sha256 ? 'noop' : 'stale';
}

/**
 * Upsert the snapshot unless noop/stale. Writes only the importer's char.
 * The pre-read is advisory; the conflict update re-checks atomically
 * (`setWhere`: not older, different sha) so an older export racing a newer
 * one can never overwrite it. No row back = nothing written.
 */
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
  if (await upsertChar(ctx, payload)) return { status: 'applied', summary };
  return { status: decideLostRace(await loadStored(ctx), ctx.sha256), summary };
}

/** True when a row was inserted or updated. */
async function upsertChar(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<boolean> {
  const values = {
    schema: ADDON_CHAR_SNAPSHOT_SCHEMA,
    data: payload.data,
    capturedAt: fromUnix(payload.exportedAt),
    importedAt: new Date(),
    payloadSha256: ctx.sha256,
  };
  const t = characterAddonSnapshots;
  const rows = await ctx.tx
    .insert(t)
    .values({ characterId: ctx.characterId, section: 'char', ...values })
    .onConflictDoUpdate({
      target: [t.characterId, t.section],
      set: values,
      // `excluded` = the incoming row: not older, and a different export.
      setWhere: sql`${t.capturedAt} <= excluded.captured_at AND ${t.payloadSha256} <> excluded.payload_sha256`,
    })
    .returning({ characterId: t.characterId });
  return rows.length > 0;
}
