import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubMediaItem } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { GuildActor } from '../guilds/guild-access.service';
import {
  HubMediaIngestPool,
  HubMediaIngestQueueFullError,
} from './hub-media-ingest.pool';
import { HubMediaReadService } from './hub-media-read.service';
import { uploadError } from './hub-media-upload.limits';
import { sniffHubMediaImage } from './hub-media.encode';
import { HubMediaService } from './hub-media.service';
import type { HubMediaIngestResult } from './hub-media.types';

/** What the route answers: the item, and whether it was just created (201). */
export interface HubMediaUploadOutcome {
  item: HubMediaItem;
  created: boolean;
}

const UPLOAD_TYPES = new Set(['png', 'jpeg', 'webp']);

const notImage = () =>
  uploadError(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'not_image',
    'Only PNG, JPEG or WebP pictures can be added.',
  );
const removed = () =>
  uploadError(
    HttpStatus.CONFLICT,
    'removed',
    'That picture was removed from this hub.',
  );
const full = () =>
  uploadError(
    HttpStatus.PAYLOAD_TOO_LARGE,
    'cap',
    "This hub's gallery is full. Ask the hub leader to remove some pictures.",
  );
const busy = () =>
  uploadError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'busy',
    'The gallery is busy — try again in a moment.',
  );

/**
 * ROK-1965 §4.3 — after the guard (400 id, 404 gate, 429 per-user window)
 * and multer's 413: magic-byte type (415, GIF refused) → the shared encode pool
 * (503 when full) → `ingestUpload` → the item as this viewer sees it.
 */
@Injectable()
export class HubMediaUploadService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly store: HubMediaService,
    private readonly pool: HubMediaIngestPool,
    private readonly read: HubMediaReadService,
  ) {}

  async upload(
    actor: GuildActor,
    guildId: number,
    bytes: Buffer,
  ): Promise<HubMediaUploadOutcome> {
    const viewer = await this.read.viewer(actor, guildId);
    const type = sniffHubMediaImage(bytes);
    if (type === null || !UPLOAD_TYPES.has(type)) throw notImage();
    const result = await this.ingest(actor, guildId, bytes);
    const mediaId = mediaIdOf(result);
    try {
      const row = await this.read.visibleRow(viewer, mediaId);
      return {
        item: this.read.toItem(row, viewer),
        created: result.status === 'stored',
      };
    } catch (err) {
      // The same bytes are on the hub but hidden from this member (D8).
      if (err instanceof NotFoundException) throw removed();
      throw err;
    }
  }

  private async ingest(
    actor: GuildActor,
    guildId: number,
    bytes: Buffer,
  ): Promise<HubMediaIngestResult> {
    const authorName = await this.authorName(actor.id);
    try {
      return await this.pool.run(
        `upload:${guildId}:${actor.id}`,
        () =>
          this.store.ingestUpload({
            guildId,
            uploaderId: actor.id,
            authorName,
            caption: null,
            bytes,
          }),
        'droppable',
      );
    } catch (err) {
      if (err instanceof HubMediaIngestQueueFullError) throw busy();
      throw err;
    }
  }

  /** D6: the uploader's display-name snapshot at upload time. */
  private async authorName(userId: number): Promise<string | null> {
    const [u] = await this.db
      .select({
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return u ? (u.displayName ?? u.username) : null;
  }
}

/** `ingestUpload` result → the row id to answer with, or the §6 error. */
export function mediaIdOf(result: HubMediaIngestResult): number {
  if (result.status === 'stored') return result.mediaId;
  if (result.status === 'duplicate') {
    if (result.mediaId === null) throw removed();
    return result.mediaId;
  }
  if (result.reason === 'removed') throw removed();
  if (result.reason === 'cap') throw full();
  if (result.reason === 'busy') throw busy();
  throw notImage();
}
