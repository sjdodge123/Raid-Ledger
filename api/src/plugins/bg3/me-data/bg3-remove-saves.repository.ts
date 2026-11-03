/**
 * ROK-2068 — "Remove uploaded saves" for chosen campaign keys. ONE
 * transaction, in `deleteAllFor`'s lock order (ROK-1960 F5b + P2-3), removes
 * the caller's `bg3-save` latest-wins markers for those keys (operator ruling
 * 2026-11-03: a re-sent copy of a removed save is accepted again), their key
 * bindings and their saves, then releases thumbnail refs no remaining save of
 * theirs still uses, and tombstones + scrubs their Gallery pictures (every
 * hub) that no remaining save shows — in the SAME transaction, so a failure
 * anywhere rolls back everything and a retry finds the keys again (review
 * P2-1). Only the picture-file unlinks run after commit. Default campaign and party claims are not per key and
 * stay (D-5). Every statement is scoped to the caller and cannot violate a
 * constraint, so nothing is caught and retried (postgres.js poisons the tx).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  tombstoneSourceRowsByKeys,
  type HubMediaRemovedFile,
} from '../../../hub-media/hub-media.repository';
import { lockCompanionUserBlobs } from '../../../companion/blobs/companion-blob-lock';
import { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import { BG3_SAVE_CONTRACT_ID } from '../bg3.constants';
import { lockBg3Gallery } from '../gallery/bg3-gallery-lock';
import { galleryProvenanceKey } from '../gallery/bg3-gallery-sync.helpers';
import { lockBg3UserCampaigns } from '../campaigns/bg3-campaign-lock';
import { lockBg3UserMarkers } from '../ingest/bg3-marker-lock';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const s = schema.bg3Saves;

/** What one removal did; `galleryFiles` = tombstoned pictures to unlink. */
export interface Bg3RemovedSaves {
  saves: number;
  campaignKeys: number;
  thumbnailRefs: number;
  galleryFiles: HubMediaRemovedFile[];
}

/** The caller's `bg3-save` markers for `keys` (latest_key IS the key). */
async function clearKeyMarkers(
  tx: Tx,
  userId: number,
  keys: string[],
): Promise<void> {
  const m = schema.companionIngestLatest;
  await tx
    .delete(m)
    .where(
      and(
        eq(m.userId, userId),
        eq(m.contract, BG3_SAVE_CONTRACT_ID),
        inArray(m.latestKey, keys),
      ),
    );
}

async function unbindKeys(
  tx: Tx,
  userId: number,
  keys: string[],
): Promise<number> {
  const k = schema.bg3CampaignKeys;
  const res = await tx
    .delete(k)
    .where(and(eq(k.userId, userId), inArray(k.campaignKey, keys)));
  return res.count;
}

/** The caller's saves with `keys`, deleted; returns the distinct shas. */
async function deleteKeySaves(
  tx: Tx,
  userId: number,
  keys: string[],
): Promise<{ count: number; shas: string[] }> {
  const rows = await tx
    .delete(s)
    .where(and(eq(s.uploaderUserId, userId), inArray(s.campaignKey, keys)))
    .returning({ sha: s.thumbnailSha256 });
  const shas = new Set<string>();
  for (const r of rows) if (r.sha !== null) shas.add(r.sha);
  return { count: rows.length, shas: [...shas] };
}

/** The caller's remaining non-null shas — NOT NULL: `NOT IN (… NULL)` keeps all. */
function remainingShas(tx: Tx, userId: number) {
  return tx
    .select({ sha: s.thumbnailSha256 })
    .from(s)
    .where(and(eq(s.uploaderUserId, userId), isNotNull(s.thumbnailSha256)));
}

/** Of `shas`, those no remaining save of the caller still shows. */
async function unusedShas(
  tx: Tx,
  userId: number,
  shas: string[],
): Promise<string[]> {
  if (shas.length === 0) return [];
  const kept = await tx
    .selectDistinct({ sha: s.thumbnailSha256 })
    .from(s)
    .where(and(eq(s.uploaderUserId, userId), inArray(s.thumbnailSha256, shas)));
  const used = new Set(kept.map((r) => r.sha));
  return shas.filter((sha) => !used.has(sha));
}

@Injectable()
export class Bg3RemoveSavesRepository {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly blobs: CompanionBlobStore,
  ) {}

  /**
   * Removes the caller's saves for `keys` (deduped, non-empty). `startedAt`
   * is the ref cutoff, as in `deleteAllFor`. Lock order: blob → gallery →
   * markers → marker rows → campaign → binding / save rows.
   */
  removeKeysFor(
    userId: number,
    keys: string[],
    startedAt = new Date(),
  ): Promise<Bg3RemovedSaves> {
    return this.db.transaction(async (tx) => {
      await lockCompanionUserBlobs(tx, userId);
      // A Gallery copy in flight finishes (or re-checks the save) first.
      await lockBg3Gallery(tx, userId);
      await lockBg3UserMarkers(tx, userId);
      // Marker rows BEFORE the campaign lock: ingest advances its marker and
      // only then takes that lock in `resolveCampaign` (F5b).
      await clearKeyMarkers(tx, userId, keys);
      await lockBg3UserCampaigns(tx, userId);
      const campaignKeys = await unbindKeys(tx, userId, keys);
      const saves = await deleteKeySaves(tx, userId, keys);
      const thumbnailRefs = await this.blobs.releaseUnusedRefsIn(tx, {
        userId,
        contract: BG3_SAVE_CONTRACT_ID,
        shas: saves.shas,
        referencedBefore: startedAt,
        stillUsed: remainingShas(tx, userId),
      });
      const galleryShas = await unusedShas(tx, userId, saves.shas);
      const galleryFiles = await tombstoneSourceRowsByKeys(
        tx,
        'bg3-save',
        userId,
        galleryShas.map(galleryProvenanceKey),
      );
      return { saves: saves.count, campaignKeys, thumbnailRefs, galleryFiles };
    });
  }
}
