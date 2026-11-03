/**
 * ROK-1966 — the `bg3-screenshot` v1 companion contract handler, owned by
 * the `bg3` plugin. C3 has already validated the message and checked its
 * blob ref (the per-user blob lock is held) before `handle` runs on the
 * ingest tx. The picture lands in the target hub's Gallery (`hub_media`,
 * source `bg3-screenshot`, kind `screenshot`); the `bg3-screenshot` media
 * gate hides it while the hub hides spoilers, like save pictures.
 */
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type {
  Bg3ScreenshotMessage,
  CompanionConfigHubTarget,
  CompanionWebpRef,
} from '@raid-ledger/contract';
import { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import type {
  CompanionHandlerContext,
  CompanionInTxHandler,
} from '../../../companion/ingest/companion-handler.registry';
import { companionError } from '../../../companion/ingest/companion-ingest.errors';
import type { CompanionDeviceTx } from '../../../companion/devices/companion-device-lock';
import type { HubMediaStoreRow } from '../../../hub-media/hub-media-store.helpers';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { readBg3BlobIn } from '../read/bg3-thumbnail.encode';
import { checkScreenshotRate } from './bg3-screenshot.limits';
import { Bg3ScreenshotTargets } from './bg3-screenshot.targets';
import {
  bg3ScreenshotProvenanceKey,
  isLiveBg3HubMember,
  screenshotHeld,
  storeBg3Screenshot,
  uploaderName,
  type Bg3ScreenshotStoreOutcome,
} from './bg3-screenshot.repository';

const TARGET_PATH = 'payload.target.hubGuildId';

/** Q3: the target must be a BG3 hub the uploader is a live member of. */
async function assertTarget(
  tx: CompanionDeviceTx,
  userId: number,
  msg: Bg3ScreenshotMessage,
): Promise<void> {
  if (await isLiveBg3HubMember(tx, userId, msg.payload.target.hubGuildId))
    return;
  throw companionError(
    'invalid_payload',
    "target hub is not a Baldur's Gate 3 hub you are a member of",
    { issues: [{ path: TARGET_PATH, code: 'not_a_member' }] },
  );
}

/** The Gallery row for an accepted screenshot (source `bg3-screenshot`). */
function galleryRow(
  userId: number,
  authorName: HubMediaStoreRow['authorName'],
  msg: Bg3ScreenshotMessage,
): HubMediaStoreRow {
  const { image, target, takenAt } = msg.payload;
  return {
    guildId: target.hubGuildId,
    source: 'bg3-screenshot',
    kind: 'screenshot',
    provenanceKey: bg3ScreenshotProvenanceKey(image.sha256),
    uploadedBy: userId,
    authorName,
    caption: null,
    capturedAt: new Date(takenAt),
    discord: null,
  };
}

/** A refused store outcome → its wire error; `stored`/`duplicate` pass. */
function assertStored(outcome: Bg3ScreenshotStoreOutcome): void {
  if (outcome === 'not_image')
    throw companionError('invalid_blob', 'screenshot does not decode');
  // No closer wire code exists (adding one is a contract change): here it
  // means the HUB's Gallery is full, not the user's blobs (CONTRACT.md §3).
  if (outcome === 'cap')
    throw companionError('blob_quota_exceeded', 'the hub Gallery is full');
}

@Injectable()
export class Bg3ScreenshotHandler implements CompanionInTxHandler<Bg3ScreenshotMessage> {
  /** A literal: the ownership guard's scan reads it (`BG3_SCREENSHOT_CONTRACT_ID`). */
  readonly contract = 'bg3-screenshot';
  readonly versions: readonly number[] = [1];
  /** AC1 (≤ 60 s to the Gallery): a burst of screenshots must not wait 2 min each. */
  readonly cadence = { minIntervalSec: 5 };

  constructor(
    private readonly blobs: CompanionBlobStore,
    private readonly targets: Bg3ScreenshotTargets,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  blobRefs(msg: Bg3ScreenshotMessage): readonly CompanionWebpRef[] {
    return [msg.payload.image];
  }

  /**
   * AC2: a screenshot already in the hub (live or Removed) acks `stale`.
   * The target is checked first, so a non-member never learns what a hub
   * holds.
   */
  async alreadyHeld(
    tx: CompanionDeviceTx,
    userId: number,
    msg: Bg3ScreenshotMessage,
  ): Promise<boolean> {
    await assertTarget(tx, userId, msg);
    const key = bg3ScreenshotProvenanceKey(msg.payload.image.sha256);
    return screenshotHeld(tx, msg.payload.target.hubGuildId, key);
  }

  async handle(
    ctx: CompanionHandlerContext,
    msg: Bg3ScreenshotMessage,
  ): Promise<void> {
    // Defence in depth: `alreadyHeld` checked the target on this same tx.
    await assertTarget(ctx.tx, ctx.userId, msg);
    const { image } = msg.payload;
    // Review P1: on the ingest tx — never a second pooled connection.
    const raw = await readBg3BlobIn(
      this.blobs,
      ctx.tx,
      ctx.userId,
      image.sha256,
    );
    if (!raw) throw companionError('invalid_blob', 'screenshot blob missing');
    await checkScreenshotRate(this.redis, ctx.userId);
    const authorName = await uploaderName(ctx.tx, ctx.userId);
    const row = galleryRow(ctx.userId, authorName, msg);
    const outcome = await storeBg3Screenshot(ctx.tx, row, raw, image.sha256);
    assertStored(outcome);
    // The Gallery holds its own re-encoded copy: release the raw blob's ref
    // on this tx, so the daily cleanup reaps the blob and frees the user's
    // 64 MiB blob quota for later screenshots and save thumbnails (review P2).
    await this.blobs.releaseHeldRefsIn(ctx.tx, ctx.userId, this.contract, [
      image.sha256,
    ]);
  }

  /** `/config` hub picker (Q3): the caller's BG3 hubs, default pre-selected. */
  hubTargets(userId: number): Promise<CompanionConfigHubTarget[]> {
    return this.targets.forUser(userId);
  }
}
