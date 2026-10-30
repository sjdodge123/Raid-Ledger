/**
 * ROK-1917 Codex P2 — the raid pull insert, with a reporter hand-over for
 * exact duplicates.
 *
 * Raid progress (Q1) only counts pulls whose reporter is a linked roster user
 * of the hub (or deleted). With a plain `ON CONFLICT DO NOTHING` a duplicate
 * kept its FIRST reporter, so a pull vanished once that reporter left the
 * roster even though a current member re-imported it. Rule: a re-import takes
 * a stored pull only when the stored reporter is non-NULL and NOT a linked
 * roster user of any `wow_guild` hub in the pull's scope, AND the importer IS.
 * An outsider never takes a trusted pull; a member never takes another
 * member's; a NULL (since-deleted) reporter is already trusted and stays put.
 *
 * Round-2 review: a hand-over replaces the row's CONTENT (success, difficulty,
 * end, name, roster, …) with the importer's too — otherwise an outsider's
 * forged kill would start counting once a member re-imported the same pull.
 * Only the id, the dedupe key and `importedAt` survive.
 *
 * Atomicity: one `INSERT … ON CONFLICT DO UPDATE … WHERE <stored reporter
 * untrusted>` statement — Postgres evaluates the WHERE against the locked
 * current row, so a concurrent hand-over is never undone, and `RETURNING
 * (xmax = 0)` tells genuine inserts from hand-overs so `newPulls` stays
 * insert-only. Nothing here catches and retries (a failed statement poisons
 * the postgres.js transaction).
 *
 * Trust scope is deliberately conservative: it is the UNION of the linked
 * rosters of every `wow_guild` hub sharing (game, region, guild name key),
 * even when those hubs sit on different realms — the pull's dedupe key has no
 * realm, so any of them could be the pull's guild. A same-named guild on
 * another realm can therefore count as trusted; it can never make a trusted
 * reporter lose a pull.
 */
import {
  getTableColumns,
  isNotNull,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  addonEncounterPulls,
  type AddonEncounterPullInsert,
} from '../../../drizzle/schema';
import { loadGuildLinkedUserIds } from '../guilds/roster-insights/roster-insights.refs';
import {
  guidOnScopeRoster,
  pullScopeHubIds,
} from '../guilds/roster-insights/roster-insights.pull-scope';
import type {
  AddonApplyContext,
  AddonImportTx,
} from './addon-import-apply.types';

type PullColumn = keyof typeof addonEncounterPulls._.columns;

/** Never rewritten by a hand-over: the id, the dedupe key, the first import time. */
const KEPT_COLUMNS: ReadonlySet<PullColumn> = new Set<PullColumn>([
  'id',
  'gameId',
  'region',
  'encounterId',
  'startAt',
  'guildKey',
  'importedAt',
]);

const p = addonEncounterPulls;
const DEDUPE_TARGET = [
  p.gameId,
  p.region,
  p.encounterId,
  p.startAt,
  p.guildKey,
];

/** True when the importer may take over untrusted duplicates of this scope. */
export function takeoverEligible(
  guildKey: string,
  importer: number,
  trusted: ReadonlySet<number>,
): boolean {
  return guildKey !== '' && trusted.has(importer);
}

/**
 * First row of each (encounter, start) key. `ON CONFLICT DO UPDATE` refuses a
 * statement that hits the same row twice, so in-payload repeats go first.
 */
export function dedupePullRows(
  rows: readonly AddonEncounterPullInsert[],
): AddonEncounterPullInsert[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.encounterId}:${r.startAt.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `col = excluded.col` for every content column (see `KEPT_COLUMNS`). */
function takeoverSet(): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(getTableColumns(p))) {
    if (KEPT_COLUMNS.has(key as PullColumn)) continue;
    set[key] = sql.raw(`excluded."${col.name}"`);
  }
  return set;
}

/**
 * The pull insert. `trusted` null = the importer may not take over, so every
 * duplicate is skipped; otherwise an untrusted, non-NULL stored reporter's
 * duplicate is rewritten with the importer's row.
 */
export function buildPullInsert(
  tx: Pick<AddonImportTx, 'insert'>,
  rows: AddonEncounterPullInsert[],
  trusted: ReadonlySet<number> | null,
) {
  const insert = tx.insert(p).values(rows);
  const returning = { id: p.id, inserted: sql<boolean>`(xmax = 0)` };
  if (trusted === null) {
    return insert
      .onConflictDoNothing({ target: DEDUPE_TARGET })
      .returning(returning);
  }
  return insert
    .onConflictDoUpdate({
      target: DEDUPE_TARGET,
      set: takeoverSet(),
      setWhere: sql`${isNotNull(p.reportedByUserId)} and ${notInArray(
        p.reportedByUserId,
        [...trusted],
      )}`,
    })
    .returning(returning);
}

/**
 * ROK-1917 final P2 — the binding is applied AFTER the sections run, so on a
 * user's first import the GUID it pins is not yet on their character. When
 * that pending GUID is on an in-scope roster the importer is trusted already.
 */
export function trustWithPendingBinding(
  trusted: ReadonlySet<number>,
  importer: number,
  pendingOnRoster: boolean,
): Set<number> {
  const out = new Set(trusted);
  if (pendingOnRoster) out.add(importer);
  return out;
}

/**
 * Linked roster users of every `wow_guild` hub sharing the pull scope, plus
 * the importer when the GUID this import pins (`ctx.pendingGuid`) is on one.
 */
async function scopeLinkedUserIds(
  ctx: AddonApplyContext,
  guildKey: string,
): Promise<Set<number>> {
  const { tx, gameId, region, pendingGuid } = ctx;
  const hubIds = await pullScopeHubIds(tx, { gameId, region, guildKey });
  const ids = new Set<number>();
  for (const hubId of hubIds) {
    for (const id of await loadGuildLinkedUserIds(tx, hubId)) ids.add(id);
  }
  const pending =
    pendingGuid && !ids.has(ctx.userId)
      ? await guidOnScopeRoster(tx, hubIds, pendingGuid)
      : false;
  return trustWithPendingBinding(ids, ctx.userId, pending);
}

/**
 * Insert the payload's pulls (one guild key per payload), handing untrusted
 * duplicates to a trusted importer. Returns how many rows were genuinely new.
 */
export async function insertPulls(
  ctx: AddonApplyContext,
  rows: AddonEncounterPullInsert[],
  guildKey: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const trusted =
    guildKey === ''
      ? new Set<number>()
      : await scopeLinkedUserIds(ctx, guildKey);
  const eligible = takeoverEligible(guildKey, ctx.userId, trusted);
  const out = await buildPullInsert(
    ctx.tx,
    dedupePullRows(rows),
    eligible ? trusted : null,
  );
  return out.filter((r) => r.inserted).length;
}
