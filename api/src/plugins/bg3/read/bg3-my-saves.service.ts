/**
 * ROK-1957 §5.4 — the uploader's own saves (`me/saves`), newest first, 50 a
 * page. Own area + thumbnail are always shown: the hub spoiler toggle (D-14)
 * does not apply to the owner.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Bg3MySave, Bg3MySavesResponse } from '@raid-ledger/contract';
import { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import {
  encodeHubMediaCursor,
  type HubMediaCursor,
} from '../../../hub-media/hub-media.cursor';
import { bg3OwnThumbnailUrl } from './bg3-read.mappers';
import { Bg3SavesReadRepository } from './bg3-saves.read.repository';
import { encodeBlobOr404, type Bg3ThumbnailSize } from './bg3-thumbnail.encode';

export const BG3_MY_SAVES_PAGE = 50;

type MySaveRow = Awaited<
  ReturnType<Bg3SavesReadRepository['mySaves']>
>[number];

export function toMySave(row: MySaveRow): Bg3MySave {
  return {
    id: row.id,
    saveName: row.saveName,
    savedAt: row.savedAt.toISOString(),
    campaignKey: row.campaignKey,
    campaignKeySource: row.campaignKeySource,
    campaignId: row.campaignId,
    area: row.currentLevel,
    thumbnailUrl: row.thumbnailSha256 ? bg3OwnThumbnailUrl(row.id) : null,
  };
}

@Injectable()
export class Bg3MySavesService {
  constructor(
    private readonly saves: Bg3SavesReadRepository,
    private readonly blobs: CompanionBlobStore,
  ) {}

  async list(
    userId: number,
    q: { unassigned: boolean; cursor: HubMediaCursor | null },
  ): Promise<Bg3MySavesResponse> {
    const [rows, defaultCampaignId] = await Promise.all([
      this.saves.mySaves(userId, { ...q, limit: BG3_MY_SAVES_PAGE + 1 }),
      this.saves.defaultCampaignId(userId),
    ]);
    const page = rows.slice(0, BG3_MY_SAVES_PAGE);
    const last = page.at(-1);
    const more = rows.length > BG3_MY_SAVES_PAGE && last !== undefined;
    return {
      saves: page.map(toMySave),
      nextCursor: more
        ? encodeHubMediaCursor({ capturedAt: last.savedAt, id: last.id })
        : null,
      defaultCampaignId,
    };
  }

  /** The caller's own save picture; another user's save → 404. */
  async thumbnail(
    userId: number,
    saveId: number,
    size: Bg3ThumbnailSize,
  ): Promise<Buffer> {
    const sha = await this.saves.ownThumbnail(userId, saveId);
    if (sha === null) throw new NotFoundException('Thumbnail not found');
    return encodeBlobOr404(this.blobs, userId, sha, size);
  }
}
