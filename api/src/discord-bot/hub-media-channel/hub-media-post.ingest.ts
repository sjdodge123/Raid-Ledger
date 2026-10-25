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
import { DiscordBotClientService } from '../discord-bot-client.service';
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

/** One post's ingest inputs, shared by each of its images. */
interface PostJob {
  post: PostLike;
  hub: HubMediaHubRef;
  classified: HubMediaClassified;
  /** Live media ids of the message before this run (tombstones excluded). */
  live: ReadonlySet<number>;
}

/**
 * D4 — the one own-post rule (`isOwnBotMessage`'s): the app's own user id,
 * never `author.bot` or a webhook (the screenshot mod posts via a webhook).
 */
export function isOwnAuthor(
  clientService: DiscordBotClientService,
  authorId: string | null,
): boolean {
  const ownId = clientService.getClient()?.user?.id ?? null;
  return ownId !== null && authorId === ownId;
}

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
    private readonly clientService: DiscordBotClientService,
  ) {}

  /**
   * Store every image of a new post; the first of a death post links (D6).
   * The app's own posts are skipped here, so live and backfill share D4.
   */
  async ingestPost(
    post: PostLike,
    hub: HubMediaHubRef,
  ): Promise<IngestPostSummary> {
    const summary = emptySummary();
    if (isOwnAuthor(this.clientService, post.authorId)) return summary;
    const images = postImages(post);
    if (images.length === 0) return summary;
    const classified = this.classifiers.classify(post, hub);
    if (classified.classifier === null) {
      summary.unclassified = true;
      this.logger.log(`unclassified media post ${post.id}`);
    }
    const live = await this.liveIds(hub, post.id);
    const job: PostJob = { post, hub, classified, live };
    for (const [index, image] of images.entries()) {
      await this.ingestImage(job, image, index, summary);
    }
    return summary;
  }

  /**
   * D11 edit: re-ingest the current images (idempotent) with the post's
   * stored kind — never re-classified — and tombstone images now gone,
   * telling the classifiers exactly as a delete does.
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
    const job: PostJob = { post, hub, classified, live: new Set() };
    for (const [index, image] of images.entries()) {
      await this.ingestImage(job, image, index, emptySummary());
    }
    const current = new Set(images.map((i) => this.key(post, i)));
    await this.remove(
      hub,
      existing.filter((row) => !current.has(row.provenanceKey)),
    );
  }

  /** D11 delete: tombstone every stored picture, then tell the classifiers. */
  async onDelete(messageId: string, hub: HubMediaHubRef): Promise<void> {
    const existing = await findMessageMedia(this.db, hub.guildId, messageId);
    await this.remove(hub, existing);
  }

  /** Tombstone these rows, then the classifiers' D11 rule (deaths). */
  private async remove(
    hub: HubMediaHubRef,
    rows: readonly { id: number; provenanceKey: string }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) {
      await this.media.removeByProvenance(hub.guildId, row.provenanceKey);
    }
    await this.classifiers.afterRemove(
      hub,
      rows.map((r) => r.id),
    );
  }

  /**
   * The message's live (not tombstoned) media ids. `HubMediaService.ingest`
   * answers a tombstone as `duplicate` with its id and never re-adds it, so a
   * duplicate outside this set is a removed picture nothing may link to.
   */
  private async liveIds(
    hub: HubMediaHubRef,
    messageId: string,
  ): Promise<ReadonlySet<number>> {
    const rows = await findMessageMedia(this.db, hub.guildId, messageId);
    return new Set(rows.map((r) => r.id));
  }

  private key(post: PostLike, image: PostImage): string {
    return discordProvenanceKey({
      channelId: post.channelId,
      messageId: post.id,
      attachmentId: image.attachmentId,
    });
  }

  private async ingestImage(
    job: PostJob,
    image: PostImage,
    index: number,
    summary: IngestPostSummary,
  ): Promise<void> {
    const { post, hub, classified } = job;
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
    if (res.status === 'duplicate' && !job.live.has(res.mediaId)) return;
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
