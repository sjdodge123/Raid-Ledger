import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { encodeHubMedia, type EncodedHubMedia } from './hub-media.encode';
import { unlinkMediaFiles, writeMediaFiles } from './hub-media.files';
import {
  HUB_MEDIA_DOWNLOADER,
  HubMediaDownloadError,
  parseAllowedSourceUrl,
  type HubMediaDownloader,
} from './hub-media-download';
import {
  bytesUsed,
  findByKey,
  insertIgnore,
  markRemoved,
} from './hub-media.repository';
import type {
  HubMediaIngestInput,
  HubMediaIngestResult,
  HubMediaRejectReason,
} from './hub-media.types';

type Db = PostgresJsDatabase<typeof schema>;
const DEFAULT_CAP_BYTES = 2 * 1024 * 1024 * 1024;

/** Per-hub byte cap (D6): `HUB_MEDIA_MAX_BYTES_PER_HUB`, else 2 GiB. Read per call. */
export function hubMediaCapBytes(): number {
  const raw = Number(process.env.HUB_MEDIA_MAX_BYTES_PER_HUB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CAP_BYTES;
}

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
    const encoded = await encodeHubMedia(fetched);
    if (!encoded) return reject('not_image');
    if (
      used + encoded.full.length + encoded.thumb.length >
      hubMediaCapBytes()
    ) {
      return this.capReached(input.guildId);
    }
    return this.store(input, encoded);
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

  /** Files first, then the row (D3); a lost insert race unlinks its files. */
  private async store(
    input: HubMediaIngestInput,
    encoded: EncodedHubMedia,
  ): Promise<HubMediaIngestResult> {
    const storageName = randomUUID();
    await writeMediaFiles(
      input.guildId,
      storageName,
      encoded.full,
      encoded.thumb,
    );
    let id: number | null;
    try {
      id = await insertIgnore(this.db, toRow(input, encoded, storageName));
    } catch (err) {
      await unlinkMediaFiles(input.guildId, storageName);
      throw err;
    }
    if (id !== null) return { status: 'stored', mediaId: id };
    await unlinkMediaFiles(input.guildId, storageName);
    const winner = await findByKey(this.db, input.guildId, input.provenanceKey);
    return { status: 'duplicate', mediaId: winner?.id ?? null };
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

function toRow(
  input: HubMediaIngestInput,
  enc: EncodedHubMedia,
  storageName: string,
) {
  return {
    guildId: input.guildId,
    source: input.source,
    kind: input.kind,
    provenanceKey: input.provenanceKey,
    discordChannelId: input.discord?.channelId ?? null,
    discordMessageId: input.discord?.messageId ?? null,
    discordAttachmentId: input.discord?.attachmentId ?? null,
    authorName: input.authorName?.slice(0, 64) ?? null,
    caption: input.caption?.slice(0, 200) ?? null,
    capturedAt: input.capturedAt,
    storageName,
    width: enc.width,
    height: enc.height,
    bytes: enc.full.length + enc.thumb.length,
  };
}
