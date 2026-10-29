import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { HubMediaHubRef } from '../../hub-media/hub-media-classifier.registry';
import {
  addPostSummary,
  BACKFILL_WINDOW_MS,
  emptyBackfillSummary,
  IDLE_BACKFILL,
  type HubMediaBackfillStatus,
} from './hub-media-backfill.types';
import { HubMediaChannelResolver } from './hub-media-channel.queries';
import {
  HubMediaHistorySource,
  type HistoryPort,
} from './hub-media-history.discord';
import { HubMediaIngestPool } from '../../hub-media/hub-media-ingest.pool';
import type { PostLike } from './hub-media-post.images';
import { HubMediaPostIngest } from './hub-media-post.ingest';

type Db = PostgresJsDatabase<typeof schema>;

export const NO_MEDIA_CHANNEL_MESSAGE = 'This hub has no pictures channel set';
export const CHANNEL_UNREADABLE_MESSAGE =
  'The bot cannot read the pictures channel right now';
export const BACKFILL_RUNNING_MESSAGE =
  'An import is already running for this hub';

interface Job {
  status: HubMediaBackfillStatus;
  done: Promise<void>;
}

/**
 * ROK-1941 D12 — "Import last 3 weeks": one async job per hub (a second
 * start while one runs is a 409). Pages the bound channel newest first and
 * stops at the first message older than now − 21 d; every post goes through
 * the same `ingestPost` as the live listener, so a re-run only counts
 * duplicates. In-memory: an API restart forgets the last summary.
 */
@Injectable()
export class HubMediaBackfillService {
  private readonly logger = new Logger(HubMediaBackfillService.name);
  private readonly jobs = new Map<number, Job>();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly resolver: HubMediaChannelResolver,
    private readonly history: HubMediaHistorySource,
    private readonly ingest: HubMediaPostIngest,
    private readonly pool: HubMediaIngestPool,
  ) {}

  /** The hub's running or last run; `idle` when none since boot. */
  status(guildId: number): HubMediaBackfillStatus {
    return this.jobs.get(guildId)?.status ?? IDLE_BACKFILL;
  }

  /** Start a run (400 no channel / unreadable, 409 one is running). */
  async start(guildId: number): Promise<HubMediaBackfillStatus> {
    this.assertNotRunning(guildId);
    const { hub, port } = await this.open(guildId);
    this.assertNotRunning(guildId); // a racing POST started one meanwhile
    const status: HubMediaBackfillStatus = {
      state: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      summary: emptyBackfillSummary(),
    };
    const done = this.run(guildId, hub, port, status);
    this.jobs.set(guildId, { status, done });
    return status;
  }

  /** Resolves once the hub's current run has finished (specs, shutdown). */
  async settled(guildId: number): Promise<void> {
    await this.jobs.get(guildId)?.done;
  }

  private assertNotRunning(guildId: number): void {
    const running = this.jobs.get(guildId);
    if (running?.status.state !== 'running') return;
    throw new ConflictException({
      statusCode: 409,
      message: BACKFILL_RUNNING_MESSAGE,
      job: running.status,
    });
  }

  private async open(
    guildId: number,
  ): Promise<{ hub: HubMediaHubRef; port: HistoryPort }> {
    const [row] = await this.db
      .select({ channelId: schema.guildProfiles.mediaChannelId })
      .from(schema.guildProfiles)
      .where(eq(schema.guildProfiles.guildId, guildId))
      .limit(1);
    const channelId = row?.channelId ?? null;
    const hub = channelId ? await this.resolver.resolve(channelId) : null;
    if (!channelId || !hub || hub.guildId !== guildId) {
      throw new BadRequestException(NO_MEDIA_CHANNEL_MESSAGE);
    }
    const port = this.history.open(channelId);
    if (!port) throw new BadRequestException(CHANNEL_UNREADABLE_MESSAGE);
    return { hub, port };
  }

  private async run(
    guildId: number,
    hub: HubMediaHubRef,
    port: HistoryPort,
    status: HubMediaBackfillStatus,
  ): Promise<void> {
    try {
      await this.scan(hub, port, status);
      status.state = 'done';
    } catch (err) {
      status.state = 'failed';
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`backfill hub ${guildId} failed: ${reason}`);
    }
    const finishedAt = new Date().toISOString();
    status.finishedAt = finishedAt;
    if (status.summary) status.summary.finishedAt = finishedAt;
    this.logger.log(`backfill hub ${guildId}: ${JSON.stringify(status)}`);
  }

  /** Newest-first pages until an empty page or the first too-old message. */
  private async scan(
    hub: HubMediaHubRef,
    port: HistoryPort,
    status: HubMediaBackfillStatus,
  ): Promise<void> {
    const cutoff = Date.now() - BACKFILL_WINDOW_MS;
    let before: string | undefined;
    for (;;) {
      const page = await port.fetchBefore(before);
      for (const post of page) {
        if (post.createdAt.getTime() < cutoff) return;
        await this.ingestOne(hub, post, status);
      }
      const last = page[page.length - 1];
      if (!last) return;
      before = last.id;
    }
  }

  /** One post; a throw counts as failed and the run goes on (D12). */
  private async ingestOne(
    hub: HubMediaHubRef,
    post: PostLike,
    status: HubMediaBackfillStatus,
  ): Promise<void> {
    const summary = status.summary ?? emptyBackfillSummary();
    status.summary = summary;
    summary.scanned += 1;
    summary.oldestScannedAt = post.createdAt.toISOString();
    try {
      const one = await this.pool.run(
        `backfill ${post.id}`,
        () => this.ingest.ingestPost(post, hub),
        'essential', // one post at a time per hub; shares the live cap
      );
      addPostSummary(summary, one);
    } catch (err) {
      summary.failed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`backfill post ${post.id} failed: ${reason}`);
    }
  }
}
