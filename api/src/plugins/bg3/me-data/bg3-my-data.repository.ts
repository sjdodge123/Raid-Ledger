/**
 * ROK-1957 D-18 — "Delete my BG3 data". ONE transaction removes every BG3
 * row the caller owns (claims, key bindings, default, uploaded saves —
 * the saves ARE the history — and their `bg3-save` latest-wins markers)
 * and then releases the deleted saves'
 * `bg3-save` thumbnail refs in one statement. Campaigns they created or
 * host stay: they belong to the hub (host is nulled only when the user
 * row itself is deleted). Every statement is scoped to the caller and
 * cannot violate a constraint, so nothing is caught and retried (a failed
 * statement poisons the tx under postgres.js).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { lockCompanionUserBlobs } from '../../../companion/blobs/companion-blob-lock';
import { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import { BG3_SAVE_CONTRACT_ID } from '../bg3.constants';
import { lockBg3Gallery } from '../gallery/bg3-gallery-lock';
import { lockBg3UserCampaigns } from '../campaigns/bg3-campaign-lock';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const s = schema.bg3Saves;

/** What `DELETE plugins/bg3/me/data` removed (all 0 for a user with none). */
export interface Bg3MyDataDeleted {
  saves: number;
  campaignKeys: number;
  defaultCampaign: number;
  claims: number;
  thumbnailRefs: number;
}

/** The caller's saves, deleted; returns the distinct non-null shas. */
async function deleteSaves(
  tx: Tx,
  userId: number,
): Promise<{ count: number; shas: string[] }> {
  const rows = await tx
    .delete(s)
    .where(eq(s.uploaderUserId, userId))
    .returning({ sha: s.thumbnailSha256 });
  const shas = new Set<string>();
  for (const r of rows) if (r.sha !== null) shas.add(r.sha);
  return { count: rows.length, shas: [...shas] };
}

async function deleteOwned(
  tx: Tx,
  userId: number,
): Promise<Omit<Bg3MyDataDeleted, 'saves' | 'thumbnailRefs'>> {
  const claims = await tx
    .delete(schema.bg3PartyClaims)
    .where(eq(schema.bg3PartyClaims.userId, userId));
  const keys = await tx
    .delete(schema.bg3CampaignKeys)
    .where(eq(schema.bg3CampaignKeys.userId, userId));
  const def = await tx
    .delete(schema.bg3UserDefaults)
    .where(eq(schema.bg3UserDefaults.userId, userId));
  return {
    claims: claims.count,
    campaignKeys: keys.count,
    defaultCampaign: def.count,
  };
}

/**
 * The caller's `bg3-save` latest-wins markers. Left behind, a re-upload of
 * a deleted save would be acked `stale` and never stored again.
 */
async function clearLatestMarkers(tx: Tx, userId: number): Promise<void> {
  const m = schema.companionIngestLatest;
  await tx
    .delete(m)
    .where(and(eq(m.userId, userId), eq(m.contract, BG3_SAVE_CONTRACT_ID)));
}

@Injectable()
export class Bg3MyDataRepository {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly blobs: CompanionBlobStore,
  ) {}

  /**
   * Deletes everything BG3 holds for `userId`. `startedAt` is the ref
   * cutoff: a save ingested concurrently refreshes its ref after it, so
   * that ref survives (the new row is not ours to delete yet). The blob
   * lock is taken FIRST, before any row lock — the order ingest and
   * retention use — so the three cannot deadlock; the re-take inside
   * `releaseUnusedRefsIn` is re-entrant.
   */
  deleteAllFor(
    userId: number,
    startedAt = new Date(),
  ): Promise<Bg3MyDataDeleted> {
    return this.db.transaction(async (tx) => {
      await lockCompanionUserBlobs(tx, userId);
      // ROK-1959 P1: a Gallery copy in flight finishes (or re-checks) first.
      await lockBg3Gallery(tx, userId);
      // Same per-user lock as bind / setDefault / ingest filing, so a concurrent bind can't deadlock against this delete.
      await lockBg3UserCampaigns(tx, userId);
      const owned = await deleteOwned(tx, userId);
      const saves = await deleteSaves(tx, userId);
      await clearLatestMarkers(tx, userId);
      const thumbnailRefs = await this.blobs.releaseUnusedRefsIn(tx, {
        userId,
        contract: BG3_SAVE_CONTRACT_ID,
        shas: saves.shas,
        referencedBefore: startedAt,
        // Guard: no rows should remain; NOT NULL because NOT IN (… NULL) keeps all.
        stillUsed: tx
          .select({ sha: s.thumbnailSha256 })
          .from(s)
          .where(
            and(eq(s.uploaderUserId, userId), isNotNull(s.thumbnailSha256)),
          ),
      });
      return { ...owned, saves: saves.count, thumbnailRefs };
    });
  }
}
