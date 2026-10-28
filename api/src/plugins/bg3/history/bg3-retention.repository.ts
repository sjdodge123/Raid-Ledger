/**
 * ROK-1957 D-9 / D-11 / §5.8 — the retention job's reads and writes. Each
 * `(uploader, campaign or NULL)` group is pruned in its own transaction:
 * lock the group's old rows, `planRetention`, stamp the kept last rows,
 * delete the rest, then release the deleted rows' thumbnail refs in ONE
 * statement. Every statement is built so it cannot violate a constraint —
 * no catch-and-retry inside the tx (postgres.js poisons it).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import { BG3_SAVE_CONTRACT_ID } from '../bg3.constants';
import {
  planRetention,
  type Bg3RetentionKeep,
  type Bg3RetentionRow,
} from './bg3-retention.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const s = schema.bg3Saves;

/** §6: at most this many groups per run; the rest wait for the next day. */
export const BG3_RETENTION_GROUPS_PER_RUN = 200;
/** Ids per DELETE statement (well under the bind-parameter limit). */
const DELETE_CHUNK = 1_000;

/** One retention group: an uploader's rows of one campaign, or unassigned. */
export interface Bg3RetentionGroup {
  userId: number;
  campaignId: number | null;
}

function inGroup(g: Bg3RetentionGroup) {
  return and(
    eq(s.uploaderUserId, g.userId),
    g.campaignId === null
      ? isNull(s.campaignId)
      : eq(s.campaignId, g.campaignId),
  );
}

/** The group's rows saved before `until`, oldest first, locked for the tx. */
function loadGroup(
  tx: Tx,
  g: Bg3RetentionGroup,
  until: Date,
): Promise<Bg3RetentionRow[]> {
  return tx
    .select({
      id: s.id,
      savedAt: s.savedAt,
      sessionFirstSavedAt: s.sessionFirstSavedAt,
      sessionSaveCount: s.sessionSaveCount,
      currentLevel: s.currentLevel,
      partyMaxLevel: s.partyMaxLevel,
      thumbnailSha256: s.thumbnailSha256,
    })
    .from(s)
    .where(and(inGroup(g), lt(s.savedAt, until)))
    .orderBy(s.savedAt, s.id)
    .for('update');
}

async function stampKeeps(tx: Tx, keep: readonly Bg3RetentionKeep[]) {
  for (const k of keep) {
    await tx
      .update(s)
      .set({
        sessionFirstSavedAt: k.sessionFirstSavedAt,
        sessionSaveCount: k.sessionSaveCount,
      })
      .where(eq(s.id, k.id));
  }
}

async function deleteRows(tx: Tx, ids: readonly number[]) {
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    await tx.delete(s).where(inArray(s.id, ids.slice(i, i + DELETE_CHUNK)));
  }
}

/** Retention reads/writes for `Bg3HistoryRetentionCron`. */
@Injectable()
export class Bg3RetentionRepository {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly blobs: CompanionBlobStore,
  ) {}

  /**
   * Groups with two consecutive pre-cutoff rows less than `gapMs` apart —
   * the only groups `planRetention` can thin. Collapsed sessions and
   * single-row sessions never qualify, so done groups drop out.
   */
  listGroups(cutoff: Date, gapMs: number): Promise<Bg3RetentionGroup[]> {
    const w = this.db
      .select({
        userId: s.uploaderUserId,
        campaignId: s.campaignId,
        joinsPrev: sql<boolean>`coalesce(${s.sessionFirstSavedAt}, ${s.savedAt})
          - lag(${s.savedAt}) over (partition by ${s.uploaderUserId}, ${s.campaignId} order by ${s.savedAt}, ${s.id})
          < ${gapMs / 1000}::float8 * interval '1 second'`.as('joins_prev'),
      })
      .from(s)
      .where(lt(s.savedAt, cutoff))
      .as('w');
    return this.db
      .selectDistinct({ userId: w.userId, campaignId: w.campaignId })
      .from(w)
      .where(sql`${w.joinsPrev}`)
      .orderBy(w.userId, w.campaignId)
      .limit(BG3_RETENTION_GROUPS_PER_RUN);
  }

  /** Thin one group (D-9) and release its freed refs (D-11); rows deleted. */
  pruneGroup(
    g: Bg3RetentionGroup,
    cutoff: Date,
    startedAt: Date,
    gapMs: number,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const until = new Date(cutoff.getTime() + gapMs);
      const plan = planRetention(await loadGroup(tx, g, until), cutoff, gapMs);
      if (plan.deleteIds.length === 0) return 0;
      await stampKeeps(tx, plan.keep);
      await deleteRows(tx, plan.deleteIds);
      await this.blobs.releaseUnusedRefsIn(tx, {
        userId: g.userId,
        contract: BG3_SAVE_CONTRACT_ID,
        shas: plan.releasedShas,
        referencedBefore: startedAt,
        stillUsed: tx
          .select({ sha: s.thumbnailSha256 })
          .from(s)
          .where(
            and(eq(s.uploaderUserId, g.userId), isNotNull(s.thumbnailSha256)),
          ),
      });
      return plan.deleteIds.length;
    });
  }
}
