import { readFile } from 'node:fs/promises';
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import {
  SetGuildCrestFromGallerySchema,
  SetGuildCrestSchema,
  type GuildCrestEditorState,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import { mediaFilePath } from '../../hub-media/hub-media.paths';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { isStaff, type GuildActor } from '../guild-access.service';
import { HUB_NOT_FOUND } from '../hub-hidden.helpers';
import {
  encodeGuildCrest,
  type GuildCrestEncodeResult,
} from './hub-crest.encode';
import { checkCrestUploadRate, crestUploadError } from './hub-crest.limits';
import { removeUploadPatch, setPatch, uploadPatch } from './hub-crest.patches';
import {
  deleteCrestFiles,
  isGuildCrestKey,
  writeCrestFiles,
} from './hub-crest.paths';
import {
  findCrestRow,
  findGalleryStorageName,
  updateCrestRow,
  type CrestRow,
} from './hub-crest.queries';
import { buildGuildCrestEditorState } from './hub-crest.resolve';

type Db = PostgresJsDatabase<typeof schema>;
type EncodeFailure = Extract<GuildCrestEncodeResult, { ok: false }>;

const PICTURE_NOT_FOUND = 'Picture not found';

/** An encode refusal → the coded error the web maps (415 / 422). */
function encodeError(code: EncodeFailure['code']): Error {
  if (code === 'not_image') {
    return crestUploadError(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      code,
      'Only PNG, JPEG or WebP pictures can be a crest.',
    );
  }
  const message =
    code === 'too_small'
      ? 'That picture is too small (at least 64 × 64).'
      : 'That picture is too large (at most 1024 × 1024).';
  return crestUploadError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

/**
 * ROK-1814 — the hub crest: read the editor state, pick/clear the shown
 * crest, upload one (or pick one from the hub's own gallery), and the
 * staff-only upload removal. Guards (jwt, HubVisibleGuard,
 * GuildEditorGuard) run in the controller; removal re-checks `isStaff`.
 * Old upload files are deleted only after the row update commits.
 */
@Injectable()
export class HubCrestService {
  private readonly logger = new Logger(HubCrestService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** `GET /guilds/:id/crest` — the editor state. */
  async get(guildId: number): Promise<GuildCrestEditorState> {
    const row = await findCrestRow(this.db, guildId);
    if (!row) throw new NotFoundException(HUB_NOT_FOUND);
    return buildGuildCrestEditorState(row);
  }

  /** `PUT /guilds/:id/crest` — show a preset (saving it), the upload, or nothing. */
  async set(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildCrestEditorState> {
    const parsed = SetGuildCrestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    let missingUpload = false;
    const out = await updateCrestRow(this.db, guildId, (row) => {
      const patch = setPatch(parsed.data, row, actor.id, new Date());
      missingUpload = patch === null;
      return patch;
    });
    if (out) return buildGuildCrestEditorState(out.after);
    if (missingUpload) {
      throw new BadRequestException('There is no uploaded crest to show.');
    }
    throw new NotFoundException(HUB_NOT_FOUND);
  }

  /** `POST /guilds/:id/crest/upload` — rate window, then the shared store path. */
  async upload(
    actor: GuildActor,
    guildId: number,
    bytes: Buffer,
  ): Promise<GuildCrestEditorState> {
    await checkCrestUploadRate(this.redis, actor.id);
    return this.storeEncoded(actor, guildId, bytes);
  }

  /**
   * `POST /guilds/:id/crest/from-gallery` — a live, unhidden picture of
   * THIS hub's gallery (404 otherwise) is copied and re-encoded into the
   * public crest store; the gallery original stays members-only.
   */
  async fromGallery(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildCrestEditorState> {
    const parsed = SetGuildCrestFromGallerySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const name = await findGalleryStorageName(
      this.db,
      guildId,
      parsed.data.mediaId,
    );
    if (!name) throw new NotFoundException(PICTURE_NOT_FOUND);
    await checkCrestUploadRate(this.redis, actor.id);
    const bytes = await readGalleryFile(guildId, name);
    return this.storeEncoded(actor, guildId, bytes);
  }

  /** `DELETE /guilds/:id/crest/upload` — staff only (moderation). */
  async removeUpload(
    actor: GuildActor,
    guildId: number,
  ): Promise<GuildCrestEditorState> {
    if (!isStaff(actor)) {
      throw new ForbiddenException('Only admins can remove an uploaded crest.');
    }
    const out = await updateCrestRow(this.db, guildId, (row) =>
      removeUploadPatch(row, actor.id, new Date()),
    );
    if (!out) throw new NotFoundException('There is no uploaded crest.');
    await this.dropFiles(guildId, out.before, null);
    return buildGuildCrestEditorState(out.after);
  }

  /** Encode → write files → point the row at them → drop the old files. */
  private async storeEncoded(
    actor: GuildActor,
    guildId: number,
    bytes: Buffer,
  ): Promise<GuildCrestEditorState> {
    const enc = await encodeGuildCrest(bytes);
    if (!enc.ok) throw encodeError(enc.code);
    await writeCrestFiles(guildId, enc.key, { sm: enc.sm, lg: enc.lg });
    const out = await updateCrestRow(this.db, guildId, () =>
      uploadPatch(enc.key, actor.id, new Date()),
    );
    if (!out) throw new NotFoundException(HUB_NOT_FOUND);
    await this.dropFiles(guildId, out.before, enc.key);
    return buildGuildCrestEditorState(out.after);
  }

  /** Delete the previous upload's files (after commit) unless still in use. */
  private async dropFiles(
    guildId: number,
    before: CrestRow,
    keep: string | null,
  ): Promise<void> {
    const old = before.crestUploadKey;
    if (!old || old === keep || !isGuildCrestKey(old)) return;
    try {
      await deleteCrestFiles(guildId, old);
    } catch (err) {
      this.logger.warn(
        `crest file cleanup failed for guild ${guildId}: ${String(err)}`,
      );
    }
  }
}

/** The gallery picture's full-size file; a missing file reads as 404. */
async function readGalleryFile(
  guildId: number,
  storageName: string,
): Promise<Buffer> {
  try {
    return await readFile(mediaFilePath(guildId, storageName, 'full'));
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new NotFoundException(PICTURE_NOT_FOUND);
    }
    throw err;
  }
}
