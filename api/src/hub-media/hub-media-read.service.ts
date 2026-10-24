import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  HUB_MEDIA_KINDS,
  type HubMediaItem,
  type HubMediaListQuery,
  type HubMediaListResponse,
  type HubMediaVariant,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../guilds/guild-access.service';
import {
  assertCanEditHubMedia,
  assertCanRemoveHubMedia,
  assertCanViewHubMedia,
} from './hub-media.access';
import {
  decodeHubMediaCursor,
  encodeHubMediaCursor,
  kindsForFilter,
} from './hub-media.cursor';
import { HubMediaDecoratorRegistry } from './hub-media.decorators';
import { unlinkMediaFiles } from './hub-media.files';
import { toHubMediaItem } from './hub-media.mappers';
import { mediaFilePath } from './hub-media.paths';
import {
  countVisible,
  findVisible,
  kindsPresent,
  listPage,
  setHidden,
  type HubMediaScope,
} from './hub-media.read.repository';
import { markRemoved } from './hub-media.repository';

type Db = PostgresJsDatabase<typeof schema>;
export const HUB_MEDIA_NOT_FOUND = 'Picture not found';
const DEFAULT_LIMIT = 24;

/** ROK-1942 L2 — the Gallery's reads and moderation (D7, D8, D13). */
@Injectable()
export class HubMediaReadService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly decorators: HubMediaDecoratorRegistry,
  ) {}

  async list(
    actor: GuildActor,
    guildId: number,
    query: HubMediaListQuery,
  ): Promise<HubMediaListResponse> {
    const scope = await this.scope(actor, guildId);
    const kinds = kindsForFilter(query.kind);
    const cursor = query.cursor ? decodeHubMediaCursor(query.cursor) : null;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const rows = await listPage(this.db, scope, { kinds, cursor, limit });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const present = new Set(await kindsPresent(this.db, scope));
    return {
      items: page.map((r) => this.toItem(r)),
      nextCursor:
        rows.length > limit && last
          ? encodeHubMediaCursor({ capturedAt: last.capturedAt, id: last.id })
          : null,
      total: await countVisible(this.db, scope, kinds),
      kinds: HUB_MEDIA_KINDS.filter((k) => present.has(k)),
    };
  }

  async item(
    actor: GuildActor,
    guildId: number,
    id: number,
  ): Promise<HubMediaItem> {
    return this.toItem(await this.visibleRow(actor, guildId, id));
  }

  /** Absolute path of a rendition the viewer may see (404 otherwise). */
  async filePath(
    actor: GuildActor,
    guildId: number,
    id: number,
    variant: HubMediaVariant,
  ): Promise<string> {
    const row = await this.visibleRow(actor, guildId, id);
    return mediaFilePath(guildId, row.storageName, variant);
  }

  /** D8 Hide / Unhide — editors only; reversible. */
  async setHidden(
    actor: GuildActor,
    guildId: number,
    id: number,
    hidden: boolean,
  ): Promise<HubMediaItem> {
    await assertCanEditHubMedia(this.db, this.access, actor, guildId);
    const row = await setHidden(this.db, guildId, id, hidden ? actor.id : null);
    if (!row) throw new NotFoundException(HUB_MEDIA_NOT_FOUND);
    return this.toItem(row);
  }

  /** D8 staff Remove — tombstone (never re-ingested) + unlink both files. */
  async remove(actor: GuildActor, guildId: number, id: number): Promise<void> {
    await assertCanRemoveHubMedia(this.db, this.access, actor, guildId);
    const storageName = await markRemoved(this.db, { guildId, id });
    if (!storageName) throw new NotFoundException(HUB_MEDIA_NOT_FOUND);
    await unlinkMediaFiles(guildId, storageName);
  }

  private async scope(
    actor: GuildActor,
    guildId: number,
  ): Promise<HubMediaScope> {
    const { canEdit } = await assertCanViewHubMedia(
      this.db,
      this.access,
      actor,
      guildId,
    );
    return { guildId, includeHidden: canEdit };
  }

  private async visibleRow(actor: GuildActor, guildId: number, id: number) {
    const row = await findVisible(
      this.db,
      await this.scope(actor, guildId),
      id,
    );
    if (!row) throw new NotFoundException(HUB_MEDIA_NOT_FOUND);
    return row;
  }

  private toItem(row: schema.HubMediaRow): HubMediaItem {
    return toHubMediaItem(row, this.decorators.linkFor(row));
  }
}
