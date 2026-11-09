import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AddonInstalled,
  AddonInstalledImportOutcome,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import {
  fromUnix,
  type AddonApplyContext,
  type AddonSectionOutcome,
} from './addon-import-apply.types';
import type { DecodedAddonCharExport } from './addon-import.decoder';

/**
 * ROK-2147 §4 — the `char` export's installed-addon list (lifted to
 * `payload.addons` by the decoder) on `character_installed_addons`. Runs in
 * the paste's transaction after every section, whatever the char snapshot
 * status (D7): newer-or-equal `capturedAt` with a different sha wins; block
 * ABSENT = no opinion (row untouched); `[]` stores an empty list. Only the
 * importer's own character (`ctx.characterId`) is written.
 */

const t = schema.characterInstalledAddons;

/** Anything that can `select` — the app db or an import transaction. */
type Reader = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

export interface StoredInstalledAddons {
  addons: AddonInstalled[];
  capturedAt: Date;
  payloadSha256: string;
}

/** The stored list for a character, or null when no export carried one. */
export async function loadInstalledAddons(
  db: Reader,
  characterId: string,
): Promise<StoredInstalledAddons | null> {
  const [row] = await db
    .select({
      addons: t.addons,
      capturedAt: t.capturedAt,
      payloadSha256: t.payloadSha256,
    })
    .from(t)
    .where(eq(t.characterId, characterId))
    .limit(1);
  return row ?? null;
}

/** The char outcome with the installed-addon result on its summary. */
export async function withCharInstalledAddons<S extends object>(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
  outcome: AddonSectionOutcome<S>,
): Promise<AddonSectionOutcome<S>> {
  const addons = await applyCharInstalledAddons(ctx, payload);
  if (!addons) return outcome;
  return { ...outcome, summary: { ...outcome.summary, addons } };
}

/** Dry run: the same outcome from a read only. */
export async function withCharInstalledAddonsPreview<S extends object>(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
  outcome: AddonSectionOutcome<S>,
): Promise<AddonSectionOutcome<S>> {
  const addons = await previewCharInstalledAddons(ctx, payload);
  if (!addons) return outcome;
  return { ...outcome, summary: { ...outcome.summary, addons } };
}

export async function applyCharInstalledAddons(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<AddonInstalledImportOutcome | undefined> {
  const list = payload.addons;
  if (!list) return undefined;
  const count = list.length;
  if (await upsertInstalled(ctx, list, fromUnix(payload.exportedAt))) {
    return { status: 'stored', count };
  }
  const stored = await loadInstalledAddons(ctx.tx, ctx.characterId);
  const same = stored?.payloadSha256 === ctx.sha256;
  return { status: same ? 'unchanged' : 'stale', count };
}

export async function previewCharInstalledAddons(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<AddonInstalledImportOutcome | undefined> {
  const list = payload.addons;
  if (!list) return undefined;
  const count = list.length;
  const stored = await loadInstalledAddons(ctx.tx, ctx.characterId);
  if (!stored) return { status: 'stored', count };
  if (stored.payloadSha256 === ctx.sha256)
    return { status: 'unchanged', count };
  const capturedAt = fromUnix(payload.exportedAt);
  const older = capturedAt.getTime() < stored.capturedAt.getTime();
  return { status: older ? 'stale' : 'stored', count };
}

/** True when a row was inserted or updated (the snapshot's race rule). */
async function upsertInstalled(
  ctx: AddonApplyContext,
  addons: AddonInstalled[],
  capturedAt: Date,
): Promise<boolean> {
  const values = {
    addons,
    capturedAt,
    importedAt: new Date(),
    payloadSha256: ctx.sha256,
  };
  const rows = await ctx.tx
    .insert(t)
    .values({ characterId: ctx.characterId, ...values })
    .onConflictDoUpdate({
      target: t.characterId,
      set: values,
      // `excluded` = the incoming row: not older, and a different export.
      setWhere: sql`${t.capturedAt} <= excluded.captured_at AND ${t.payloadSha256} <> excluded.payload_sha256`,
    })
    .returning({ characterId: t.characterId });
  return rows.length > 0;
}

/** ROK-2147 F6 — an owner change keeps `characters.id`: drop the old client's list. */
export async function deleteInstalledAddons(
  tx: Pick<PostgresJsDatabase<typeof schema>, 'delete'>,
  characterId: string,
): Promise<void> {
  await tx.delete(t).where(eq(t.characterId, characterId));
}
