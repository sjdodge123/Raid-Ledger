/**
 * ROK-1957 §5.7 — the gallery hook ROK-1959 consumes (exposed, no caller in
 * C4). Canonical saves with a thumbnail, per hub; empty while the hub's
 * spoiler toggle is on (D-14). ROK-1959 copies the bytes into `hub_media`
 * itself, so retention (D-9) never deletes a Gallery picture.
 */
import { Injectable } from '@nestjs/common';
import { CompanionBlobStore } from '../../companion/blobs/companion-blob.store';
import { pickCanonical } from './history/bg3-canonical.helpers';
import { Bg3ReadRepository } from './read/bg3-read.repository';
import { Bg3SavesReadRepository } from './read/bg3-saves.read.repository';
import { encodeBg3Thumbnail, readBg3Blob } from './read/bg3-thumbnail.encode';

export interface Bg3GalleryItem {
  saveId: number;
  uploaderUserId: number;
  uploaderDisplayName: string;
  sha256: string;
  savedAt: Date;
  campaignId: number;
  /** The save's `currentLevel` — the snapshot's `area` label. */
  area: string;
  /** `<campaignKey>:<savedAt ISO>` — stable across twins of one save. */
  provenanceKey: string;
}

type FeedRow = Awaited<ReturnType<Bg3SavesReadRepository['feedRows']>>[number];

/** D-7 per campaign, then rows with a picture. */
export function toGalleryItems(rows: readonly FeedRow[]): Bg3GalleryItem[] {
  const byCampaign = new Map<number, FeedRow[]>();
  for (const r of rows)
    byCampaign.set(r.campaignId, [...(byCampaign.get(r.campaignId) ?? []), r]);
  return [...byCampaign.values()]
    .flatMap((group) => pickCanonical(group, group[0]?.hostUserId ?? null))
    .flatMap((r) =>
      r.sha256 === null
        ? []
        : [
            {
              saveId: r.id,
              uploaderUserId: r.uploaderUserId,
              uploaderDisplayName: r.displayName ?? r.username,
              sha256: r.sha256,
              savedAt: r.savedAt,
              campaignId: r.campaignId,
              area: r.area,
              provenanceKey: `${r.campaignKey}:${r.savedAt.toISOString()}`,
            },
          ],
    );
}

@Injectable()
export class Bg3GalleryFeed {
  constructor(
    private readonly saves: Bg3SavesReadRepository,
    private readonly read: Bg3ReadRepository,
    private readonly blobs: CompanionBlobStore,
  ) {}

  /** BG3 community hubs with a non-archived campaign. */
  bg3HubIds(): Promise<number[]> {
    return this.saves.bg3HubIds();
  }

  async canonicalThumbnails(guildId: number, sinceSavedAt?: Date) {
    const settings = await this.read.settings(guildId);
    if (settings.hideLocationAndScreenshots) return [];
    return toGalleryItems(await this.saves.feedRows(guildId, sinceSavedAt));
  }

  /** Raw stored bytes (1959 re-encodes once); null when hidden or gone. */
  async openRawThumbnail(saveId: number): Promise<Buffer | null> {
    const save = await this.saves.saveInCampaign(saveId);
    if (!save?.thumbnailSha256) return null;
    const settings = await this.read.settings(save.guildId);
    if (settings.hideLocationAndScreenshots) return null;
    return readBg3Blob(this.blobs, save.uploaderUserId, save.thumbnailSha256);
  }

  /** The D-12 re-encoded full rendition. */
  async openThumbnail(saveId: number): Promise<Buffer | null> {
    const raw = await this.openRawThumbnail(saveId);
    return raw ? encodeBg3Thumbnail(raw, 'full') : null;
  }
}
