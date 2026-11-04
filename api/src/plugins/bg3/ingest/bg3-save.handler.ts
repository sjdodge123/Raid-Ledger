/**
 * ROK-1957 §5.2 — the `bg3-save` v1 companion contract handler, owned by
 * the `bg3` plugin. C3 has already validated the message, checked its blob
 * refs and applied latest-wins before `handle` runs on the ingest tx.
 *
 * Per-user lock order on that tx (ROK-1960 F5b + P2-3): device row share →
 * blob lock (only with a thumbnail) → markers lock ({@link
 * Bg3SaveHandler.lockLatestWins}, just before the marker upsert) → "already
 * held" read (ROK-2070 M1) → marker row → campaign lock (`resolveCampaign`) → `bg3_saves` insert. "Delete my
 * BG3 data" keeps the same order, so the two serialise instead of a new
 * key's uncommitted marker slipping past the delete.
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Bg3SaveMessage, CompanionWebpRef } from '@raid-ledger/contract';
import type {
  CompanionInTxHandler,
  CompanionHandlerContext,
} from '../../../companion/ingest/companion-handler.registry';
import type { CompanionIngestVia } from '../../../companion/ingest/companion-ingest-request';
import type { CompanionDeviceTx } from '../../../companion/devices/companion-device-lock';
import { lockBg3UserMarkers } from './bg3-marker-lock';
import {
  Bg3SavesWriteRepository,
  legacyMarkerHolds,
  saveAlreadyHeld,
  type Bg3SaveInsert,
} from './bg3-saves.write.repository';

/**
 * D-4 (ROK-2070 B1): the `bg3-save` latest-wins marker key — ONE save, not
 * one campaign key. A GameID key is shared by every save of a playthrough,
 * so a marker on the bare key would refuse any older save sent after a newer
 * one; hashing in `saveName` restores the per-save scope a folder key had.
 * 64 hex chars (under the 128-char marker cap). Markers written before this
 * change (keyed by the bare campaign key) are never advanced again, but
 * {@link Bg3SaveHandler.alreadyHeld} still honours them (Codex P2), so a
 * replay of an old save is refused even after retention pruned its row. Exported so a delete path
 * can compute the same key for the rows it removes.
 */
export function bg3LatestMarkerKey(
  campaignKey: string,
  saveName: string,
): string {
  return createHash('sha256')
    .update(`${campaignKey}\n${saveName}`, 'utf8')
    .digest('hex');
}

/** Highest level among the non-summons (summons only as a fallback). */
export function partyMaxLevel(
  party: Bg3SaveMessage['payload']['party'],
): number {
  const heroes = party.filter((m) => !m.isSummon);
  const levels = (heroes.length > 0 ? heroes : party).map((m) => m.level);
  return levels.length > 0 ? Math.max(...levels) : 0;
}

/** The `bg3_saves` row for one accepted message. */
export function toBg3SaveRow(
  ctx: Pick<CompanionHandlerContext, 'userId' | 'deviceId' | 'receivedAt'>,
  msg: Bg3SaveMessage,
  campaignId: number | null,
): Bg3SaveInsert {
  const p = msg.payload;
  return {
    uploaderUserId: ctx.userId,
    deviceId: ctx.deviceId,
    campaignId,
    campaignKey: p.campaignKey,
    campaignKeySource: p.campaignKeySource,
    saveName: p.saveName,
    savedAt: new Date(p.savedAt),
    capturedAt: new Date(msg.capturedAt),
    receivedAt: ctx.receivedAt,
    gameVersion: p.gameVersion,
    platform: p.platform,
    currentLevel: p.currentLevel,
    difficulty: p.difficulty,
    ruleset: p.ruleset,
    party: p.party,
    partyMaxLevel: partyMaxLevel(p.party),
    thumbnailSha256: p.thumbnail?.sha256 ?? null,
    thumbnailWidth: p.thumbnail?.width ?? null,
    thumbnailHeight: p.thumbnail?.height ?? null,
  };
}

@Injectable()
export class Bg3SaveHandler implements CompanionInTxHandler<Bg3SaveMessage> {
  /** A literal: the ownership guard's scan reads it (`BG3_SAVE_CONTRACT_ID`). */
  readonly contract = 'bg3-save';
  readonly versions: readonly number[] = [1];
  /** D-5: the browser drag-and-drop path (ROK-1960) posts as a session. */
  readonly sources: readonly CompanionIngestVia[] = ['device', 'session'];

  constructor(private readonly repo: Bg3SavesWriteRepository) {}

  /** D-4: one latest marker per save ({@link bg3LatestMarkerKey}). */
  latestWins(msg: Bg3SaveMessage): { key: string; at: Date } {
    const { campaignKey, saveName, savedAt } = msg.payload;
    return {
      key: bg3LatestMarkerKey(campaignKey, saveName),
      at: new Date(savedAt),
    };
  }

  /**
   * P2-3: the per-user markers lock. `CompanionIngestService.commit` calls
   * it on the ingest tx immediately before the latest-wins marker upsert
   * (after any blob lock, before the campaign lock) — the same lock "Delete
   * my BG3 data" takes before it clears this user's markers.
   */
  lockLatestWins(tx: CompanionDeviceTx, userId: number): Promise<void> {
    return lockBg3UserMarkers(tx, userId);
  }

  /**
   * ROK-2070 M1: is this save already stored for the uploader (the same
   * `(campaignKey, savedAt)`, or the same save under another key — see
   * {@link saveAlreadyHeld}) or held by a pre-B1 bare-key marker ({@link
   * legacyMarkerHolds}, Codex P2)? `CompanionIngestService.commit` calls it after
   * {@link lockLatestWins} and before the marker upsert; true acks `stale`.
   *
   * The per-user MARKERS lock is enough here, and the campaign lock is not
   * taken early: the read covers only the uploader's own `bg3_saves`
   * identity columns (key, source, name, savedAt). Every writer that adds or
   * removes such a row — ingest, "Delete my BG3 data", remove saves — takes
   * the markers lock first and holds it to commit, so the read is serialised
   * with them; bind / unbind / default changes only re-file `campaign_id`,
   * which the read ignores. Lock order is unchanged (blob → markers →
   * campaign). The marker read is covered by the same lock: every marker
   * writer or deleter for this contract holds it.
   */
  async alreadyHeld(
    tx: CompanionDeviceTx,
    userId: number,
    msg: Bg3SaveMessage,
  ): Promise<boolean> {
    if (await legacyMarkerHolds(tx, userId, msg.payload)) return true;
    return saveAlreadyHeld(tx, userId, msg.payload);
  }

  blobRefs(msg: Bg3SaveMessage): readonly CompanionWebpRef[] {
    return msg.payload.thumbnail ? [msg.payload.thumbnail] : [];
  }

  async handle(
    ctx: CompanionHandlerContext,
    msg: Bg3SaveMessage,
  ): Promise<void> {
    const campaignId = await this.campaignFor(ctx, msg.payload.campaignKey);
    await this.repo.insertSave(ctx.tx, toBg3SaveRow(ctx, msg, campaignId));
  }

  /**
   * D-6 resolution; a campaign whose hub the uploader left → unassigned.
   * The membership read runs on `ctx.tx` (review fix 1), never the pool.
   */
  private async campaignFor(
    ctx: CompanionHandlerContext,
    campaignKey: string,
  ): Promise<number | null> {
    const target = await this.repo.resolveCampaign(
      ctx.tx,
      ctx.userId,
      campaignKey,
    );
    if (target === null) return null;
    const member = await this.repo.isHubMember(
      ctx.tx,
      ctx.userId,
      target.guildId,
    );
    return member ? target.id : null;
  }
}
