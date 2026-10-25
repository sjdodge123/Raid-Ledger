import { Inject, Injectable, Logger } from '@nestjs/common';
import type { HubMediaKind } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  HubMediaPostClassifierRegistry,
  type HubMediaClassified,
  type HubMediaHubRef,
  type HubMediaPostClassification,
} from '../../hub-media/hub-media-classifier.registry';
import { HubMediaService } from '../../hub-media/hub-media.service';
import { discordProvenanceKey } from '../../hub-media/hub-media.types';
import { findMessageMedia } from './hub-media-channel.queries';
import {
  postImages,
  type PostImage,
  type PostLike,
} from './hub-media-post.images';

type Db = PostgresJsDatabase<typeof schema>;

/** What one post did to the store (L3 backfill sums these). */
export interface IngestPostSummary {
  images: number;
  stored: number;
  duplicates: number;
  failed: number;
  deathsLinked: number;
  deathsInferred: number;
  unclassified: boolean;
}

const emptySummary = (): IngestPostSummary => ({
  images: 0,
  stored: 0,
  duplicates: 0,
  failed: 0,
  deathsLinked: 0,
  deathsInferred: 0,
  unclassified: false,
});

const KINDS: readonly string[] = ['death', 'screenshot', 'image'];
const isKind = (v: string): v is HubMediaKind => KINDS.includes(v);

/**
 * ROK-1941 — a bound channel's post → hub gallery (+ the classifier's death
 * link). Idempotent on the 1942 provenance key; live and backfill share it.
 */
@Injectable()
export class HubMediaPostIngest {
  private readonly logger = new Logger(HubMediaPostIngest.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly media: HubMediaService,
    private readonly classifiers: HubMediaPostClassifierRegistry,
  ) {}

  /** Store every image of a new post; the first of a death post links (D6). */
  async ingestPost(
    post: PostLike,
    hub: HubMediaHubRef,
  ): Promise<IngestPostSummary> {
    const summary = emptySummary();
    const images = postImages(post);
    if (images.length === 0) return summary;
    const classified = this.classifiers.classify(post, hub);
    if (classified.classifier === null) {
      summary.unclassified = true;
      this.logger.log(`unclassified media post ${post.id}`);
    }
    for (const [index, image] of images.entries()) {
      await this.ingestImage(post, hub, image, index, classified, summary);
    }
    return summary;
  }

  /**
   * D11 edit: re-ingest the current images (idempotent) with the post's
   * stored kind — never re-classified — and tombstone images now gone.
   */
  async onEdit(post: PostLike, hub: HubMediaHubRef): Promise<void> {
    const existing = await findMessageMedia(this.db, hub.guildId, post.id);
    const first = existing[0];
    if (!first) {
      await this.ingestPost(post, hub);
      return;
    }
    const kept = { kind: isKind(first.kind) ? first.kind : 'image' };
    const classified: HubMediaClassified = {
      classification: {
        ...this.classifiers.classify(post, hub).classification,
        ...kept,
      },
      classifier: null,
    };
    const images = postImages(post);
    const summary = emptySummary();
    for (const [index, image] of images.entries()) {
      await this.ingestImage(post, hub, image, index, classified, summary);
    }
    const current = new Set(images.map((i) => this.key(post, i)));
    for (const row of existing) {
      if (current.has(row.provenanceKey)) continue;
      await this.media.removeByProvenance(hub.guildId, row.provenanceKey);
    }
  }

  /** D11 delete: tombstone every stored picture, then tell the classifiers. */
  async onDelete(messageId: string, hub: HubMediaHubRef): Promise<void> {
    const existing = await findMessageMedia(this.db, hub.guildId, messageId);
    for (const row of existing) {
      await this.media.removeByProvenance(hub.guildId, row.provenanceKey);
    }
    await this.classifiers.afterRemove(
      hub,
      existing.map((r) => r.id),
    );
  }

  private key(post: PostLike, image: PostImage): string {
    return discordProvenanceKey({
      channelId: post.channelId,
      messageId: post.id,
      attachmentId: image.attachmentId,
    });
  }

  private async ingestImage(
    post: PostLike,
    hub: HubMediaHubRef,
    image: PostImage,
    index: number,
    classified: HubMediaClassified,
    summary: IngestPostSummary,
  ): Promise<void> {
    summary.images += 1;
    const res = await this.media.ingest(
      this.toInput(post, hub, image, classified.classification),
    );
    if (res.status === 'rejected') {
      summary.failed += 1;
      this.logger.warn(`media post ${post.id} image ${index}: ${res.reason}`);
      return;
    }
    summary[res.status === 'stored' ? 'stored' : 'duplicates'] += 1;
    if (res.mediaId === null || classified.classifier === null) return;
    const outcome = await classified.classifier.afterStore({
      hub,
      post,
      classification: classified.classification,
      mediaId: res.mediaId,
      index,
      filename: image.filename,
    });
    if (outcome === 'linked') summary.deathsLinked += 1;
    if (outcome === 'inferred') summary.deathsInferred += 1;
  }

  private toInput(
    post: PostLike,
    hub: HubMediaHubRef,
    image: PostImage,
    c: HubMediaPostClassification,
  ) {
    return {
      guildId: hub.guildId,
      source: 'discord' as const,
      kind: c.kind,
      provenanceKey: this.key(post, image),
      sourceUrl: image.url,
      authorName: c.authorName,
      caption: c.caption,
      capturedAt: post.createdAt,
      discord: {
        channelId: post.channelId,
        messageId: post.id,
        attachmentId: image.attachmentId,
      },
    };
  }
}
