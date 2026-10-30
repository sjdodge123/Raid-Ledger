/**
 * ROK-1917 Codex P2 — reporter hand-over for exact duplicate pulls.
 *
 * `applyRaid` inserts with `ON CONFLICT DO NOTHING`, so a duplicate keeps its
 * FIRST reporter, and raid progress (Q1) only counts pulls whose reporter is a
 * linked roster user of the hub (or deleted). Without this, a pull vanished
 * once its first reporter left the roster even though a current member
 * re-imported it. Rule: a re-import claims a stored pull only when the stored
 * reporter is NOT a linked roster user of any `wow_guild` hub in the pull's
 * scope AND the importer IS — an outsider never takes a trusted pull.
 * Separate statements after the insert, so `newPulls` stays insert-only; the
 * UPDATE re-checks the reporter so a concurrent hand-over is never undone.
 */
import {
  and,
  eq,
  inArray,
  isNotNull,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import type { AddonRaidExport } from '@raid-ledger/contract';
import { addonEncounterPulls, guilds } from '../../../drizzle/schema';
import { loadGuildLinkedUserIds } from '../guilds/roster-insights/roster-insights.refs';
import {
  fromUnix,
  guildNameKey,
  type AddonApplyContext,
  type AddonImportTx,
} from './addon-import-apply.types';

/** A stored duplicate's id and its current reporter. */
export interface StoredReporter {
  id: number;
  reportedByUserId: number | null;
}

/**
 * True when `importer` may take over a pull reported by `existing`. NULL (a
 * since-deleted user) is already trusted by Q1, so it is never moved.
 */
export function shouldReassign(
  existing: number | null,
  importer: number,
  trusted: ReadonlySet<number>,
): boolean {
  if (existing === null || existing === importer) return false;
  return !trusted.has(existing) && trusted.has(importer);
}

/** Ids of the stored pulls the importer may claim (see `shouldReassign`). */
export function pickReassignable(
  rows: readonly StoredReporter[],
  importer: number,
  trusted: ReadonlySet<number>,
): number[] {
  return rows
    .filter((r) => shouldReassign(r.reportedByUserId, importer, trusted))
    .map((r) => r.id);
}

/** Linked roster users of every `wow_guild` hub sharing the pull scope. */
async function scopeLinkedUserIds(
  tx: AddonImportTx,
  ctx: AddonApplyContext,
  guildKey: string,
): Promise<Set<number>> {
  const hubs = await tx
    .select({ id: guilds.id })
    .from(guilds)
    .where(
      and(
        eq(guilds.gameId, ctx.gameId),
        eq(guilds.region, ctx.region),
        eq(guilds.nameKey, guildKey),
        eq(guilds.kind, 'wow_guild'),
      ),
    );
  const ids = new Set<number>();
  for (const hub of hubs) {
    for (const id of await loadGuildLinkedUserIds(tx, hub.id)) ids.add(id);
  }
  return ids;
}

/** The payload's exact `(encounter, start)` pairs within the pull scope. */
function payloadPulls(
  ctx: AddonApplyContext,
  payload: AddonRaidExport,
  guildKey: string,
): SQL | undefined {
  const p = addonEncounterPulls;
  const pairs = payload.data.pulls.map((pull) =>
    and(
      eq(p.encounterId, pull.encounterId),
      eq(p.startAt, fromUnix(pull.startAt)),
    ),
  );
  return and(
    eq(p.gameId, ctx.gameId),
    eq(p.region, ctx.region),
    eq(p.guildKey, guildKey),
    or(...pairs),
  );
}

/** The payload's already-stored pulls and their current reporters. */
async function loadStoredReporters(
  ctx: AddonApplyContext,
  payload: AddonRaidExport,
  guildKey: string,
): Promise<StoredReporter[]> {
  const p = addonEncounterPulls;
  return ctx.tx
    .select({ id: p.id, reportedByUserId: p.reportedByUserId })
    .from(p)
    .where(payloadPulls(ctx, payload, guildKey));
}

/**
 * Hand the payload's already-stored pulls to the importer where the rule
 * allows. Returns how many moved. Unguilded ('') pulls never count — skipped.
 */
export async function reassignDuplicatePulls(
  ctx: AddonApplyContext,
  payload: AddonRaidExport,
): Promise<number> {
  const guildKey = guildNameKey(payload.who.guildName);
  if (guildKey === '' || payload.data.pulls.length === 0) return 0;
  const trusted = await scopeLinkedUserIds(ctx.tx, ctx, guildKey);
  if (!trusted.has(ctx.userId)) return 0;
  const stored = await loadStoredReporters(ctx, payload, guildKey);
  const ids = pickReassignable(stored, ctx.userId, trusted);
  if (ids.length === 0) return 0;
  const p = addonEncounterPulls;
  const moved = await ctx.tx
    .update(p)
    .set({
      reportedByUserId: ctx.userId,
      reportedByCharacterId: ctx.characterId,
    })
    .where(
      and(
        inArray(p.id, ids),
        isNotNull(p.reportedByUserId),
        notInArray(p.reportedByUserId, [...trusted]),
      ),
    )
    .returning({ id: p.id });
  return moved.length;
}
