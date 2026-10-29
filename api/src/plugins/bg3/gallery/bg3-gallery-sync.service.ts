import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type * as schema from '../../../drizzle/schema';
import { HubMediaIngestPool } from '../../../hub-media/hub-media-ingest.pool';
import { existingKeys } from '../../../hub-media/hub-media.repository';
import { HubMediaService } from '../../../hub-media/hub-media.service';
import { Bg3GalleryFeed } from '../bg3-gallery.feed';
import { retentionCutoff } from '../history/bg3-retention.helpers';
import {
  galleryProvenanceKey,
  planGallerySync,
  type Bg3GalleryPick,
} from './bg3-gallery-sync.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** One pass: pictures stored, picks skipped (D-11), hubs whose sync threw. */
export interface Bg3GallerySyncRun {
  stored: number;
  skipped: number;
  failedHubs: number;
}

type CopyOutcome = 'stored' | 'skipped' | 'cap';

/**
 * ROK-1959 D-3 — pull canonical save pictures from the bg3 feed into the hub
 * Gallery (`hub_media`, source `bg3-save`). The feed is empty while a hub
 * hides spoilers, so nothing is copied then; the backlog follows on toggle-off.
 */
@Injectable()
export class Bg3GallerySyncService {
  private readonly logger = new Logger(Bg3GallerySyncService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly feed: Bg3GalleryFeed,
    private readonly hubMedia: HubMediaService,
    private readonly pool: HubMediaIngestPool,
  ) {}

  async runOnce(now: Date = new Date()): Promise<Bg3GallerySyncRun> {
    const run: Bg3GallerySyncRun = { stored: 0, skipped: 0, failedHubs: 0 };
    for (const guildId of await this.feed.bg3HubIds()) {
      try {
        await this.syncHub(guildId, now, run);
      } catch (err) {
        run.failedHubs += 1;
        this.logger.error(
          `BG3 gallery sync: hub ${guildId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (run.stored > 0)
      this.logger.log(`BG3 gallery sync: ${run.stored} picture(s) added`);
    return run;
  }

  private async syncHub(
    guildId: number,
    now: Date,
    run: Bg3GallerySyncRun,
  ): Promise<void> {
    const items = await this.feed.canonicalThumbnails(
      guildId,
      retentionCutoff(now),
    );
    const keys = items.map((i) => galleryProvenanceKey(i.sha256));
    const known = await existingKeys(this.db, guildId, keys);
    for (const pick of planGallerySync(items, known, now)) {
      const outcome = await this.copyOne(guildId, pick);
      if (outcome === 'cap') return; // D-11: the hub is full for this run.
      run[outcome] += 1;
    }
  }

  /** D-11: a missing blob or an undecodable picture is skipped, retried next run. */
  private async copyOne(
    guildId: number,
    { item, provenanceKey }: Bg3GalleryPick,
  ): Promise<CopyOutcome> {
    const bytes = await this.feed.openRawThumbnail(guildId, item.saveId);
    if (!bytes) {
      this.logger.debug(`BG3 gallery sync: save ${item.saveId} has no blob`);
      return 'skipped';
    }
    const res = await this.pool.run('bg3-gallery', () =>
      this.hubMedia.ingestFromSource({
        guildId,
        source: 'bg3-save',
        kind: 'save',
        provenanceKey,
        uploadedBy: item.uploaderUserId,
        authorName: item.uploaderDisplayName,
        caption: item.area,
        capturedAt: item.savedAt,
        bytes,
      }),
    );
    if (res.status === 'stored') return 'stored';
    if (res.status === 'rejected' && res.reason === 'cap') return 'cap';
    return 'skipped';
  }
}
