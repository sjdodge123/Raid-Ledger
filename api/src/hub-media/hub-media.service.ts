import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { unlinkMediaFiles } from './hub-media.files';
import {
  HUB_MEDIA_DOWNLOADER,
  HubMediaDownloadError,
  parseAllowedSourceUrl,
  type HubMediaDownloader,
} from './hub-media-download';
import { bytesUsed, findByKey, markRemoved } from './hub-media.repository';
import {
  encodeAndStore,
  hubMediaCapBytes,
  type HubMediaStoreOutcome,
  type HubMediaStoreRow,
} from './hub-media-store.helpers';
import {
  uploadProvenanceKey,
  type HubMediaIngestInput,
  type HubMediaIngestResult,
  type HubMediaRejectReason,
  type HubMediaUploadInput,
} from './hub-media.types';

type Db = PostgresJsDatabase<typeof schema>;

export { hubMediaCapBytes } from './hub-media-store.helpers';

const reject = (reason: HubMediaRejectReason): HubMediaIngestResult => ({
  status: 'rejected',
  reason,
});

/** ROK-1942: the shared hub media store — the ingest seam ROK-1941 calls. */
@Injectable()
export class HubMediaService {
  private readonly logger = new Logger(HubMediaService.name);
  /** guildId → UTC day of the last cap warning (warn once a day). */
  private readonly capWarned = new Map<number, string>();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    @Inject(HUB_MEDIA_DOWNLOADER)
    private readonly downloader: HubMediaDownloader,
  ) {}

  /** Download, re-encode and store one picture; idempotent on `provenanceKey` (D2). */
  async ingest(input: HubMediaIngestInput): Promise<HubMediaIngestResult> {
    const existing = await findByKey(
      this.db,
      input.guildId,
      input.provenanceKey,
    );
    if (existing) return { status: 'duplicate', mediaId: existing.id };
    const url = parseAllowedSourceUrl(input.sourceUrl);
    if (!url) return reject('host');
    const used = await bytesUsed(this.db, input.guildId);
    if (used >= hubMediaCapBytes()) return this.capReached(input.guildId);
    const fetched = await this.fetch(url);
    if (typeof fetched === 'string') return reject(fetched);
    const row: HubMediaStoreRow = { ...input, uploadedBy: null };
    return this.finish(row, fetched, used);
  }

  /**
   * ROK-1965: store a member upload (bytes already received + sniffed by
   * the route, which runs this inside `HubMediaIngestPool`). Same bytes on
   * the same hub → `duplicate` (idempotent double-submit, D5); same bytes
   * that were removed → `rejected: removed` (409).
   */
  async ingestUpload(input: HubMediaUploadInput): Promise<HubMediaIngestResult> {
    const provenanceKey = uploadProvenanceKey(input.bytes);
    const existing = await findByKey(this.db, input.guildId, provenanceKey);
    if (existing?.removedAt) return reject('removed');
    if (existing) return { status: 'duplicate', mediaId: existing.id };
    const used = await bytesUsed(this.db, input.guildId);
    if (used >= hubMediaCapBytes()) return this.capReached(input.guildId);
    const row: HubMediaStoreRow = {
      guildId: input.guildId,
      source: 'upload',
      kind: 'upload',
      provenanceKey,
      authorName: input.authorName,
      caption: input.caption,
      capturedAt: new Date(),
      discord: null,
      uploadedBy: input.uploaderId,
    };
    return this.finish(row, input.bytes, used);
  }

  /** Source deletion (D8): tombstone the row and unlink its files. */
  async removeByProvenance(
    guildId: number,
    provenanceKey: string,
  ): Promise<boolean> {
    const storageName = await markRemoved(this.db, { guildId, provenanceKey });
    if (!storageName) return false;
    await unlinkMediaFiles(guildId, storageName);
    return true;
  }

  private async fetch(url: URL): Promise<Buffer | HubMediaRejectReason> {
    try {
      return await this.downloader.download(url);
    } catch (err) {
      if (err instanceof HubMediaDownloadError && err.reason === 'too_large')
        return 'too_large';
      return 'download_failed';
    }
  }

  private async finish(
    row: HubMediaStoreRow,
    raw: Buffer,
    usedBefore: number,
  ): Promise<HubMediaIngestResult> {
    const out: HubMediaStoreOutcome = await encodeAndStore(
      this.db,
      row,
      raw,
      usedBefore,
    );
    if (out.status === 'cap') return this.capReached(row.guildId);
    if (out.status === 'not_image') return reject('not_image');
    return out;
  }

  private capReached(guildId: number): HubMediaIngestResult {
    const day = new Date().toISOString().slice(0, 10);
    if (this.capWarned.get(guildId) !== day) {
      this.capWarned.set(guildId, day);
      this.logger.warn(
        `hub ${guildId} reached its media cap; new pictures are refused`,
      );
    }
    return reject('cap');
  }
}
