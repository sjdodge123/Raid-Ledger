import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  assertCanRemoveRow,
  assertCanViewHubMedia,
  canRemoveRow,
  type HubMediaRights,
} from './hub-media.access';
import {
  decodeHubMediaCursor,
  encodeHubMediaCursor,
  kindsForFilter,
} from './hub-media.cursor';
import { HubMediaDecoratorRegistry } from './hub-media.decorators';
import { HubMediaSubjectRegistry } from './hub-media.subjects';
import { HubMediaSourceGateRegistry } from './hub-media.source-gates';
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
/** One request's viewer: who, the scope they read, and their rights. */
export interface HubMediaViewer {
  actor: GuildActor;
  scope: HubMediaScope;
  rights: HubMediaRights;
}
export const HUB_MEDIA_NOT_FOUND = 'Picture not found';
const DEFAULT_LIMIT = 24;

/** ROK-1942 L2 — the Gallery's reads and moderation (D7, D8, D13; ROK-1965 D11). */
@Injectable()
export class HubMediaReadService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly decorators: HubMediaDecoratorRegistry,
    private readonly subjects: HubMediaSubjectRegistry,
    private readonly gates: HubMediaSourceGateRegistry,
  ) {}

  /**
   * One Gallery page. ROK-2027: `subject` (after the D7 404 gate) narrows to
   * a plugin-resolved id set; an empty set is an empty page (D5).
   */
  async list(
    actor: GuildActor,
    guildId: number,
    query: HubMediaListQuery,
  ): Promise<HubMediaListResponse> {
    const viewer = await this.viewer(actor, guildId);
    const ids = query.subject
      ? await this.subjects.resolve(guildId, query.subject)
      : null;
    const present = new Set(await kindsPresent(this.db, viewer.scope));
    const kinds = HUB_MEDIA_KINDS.filter((k) => present.has(k));
    if (ids?.length === 0) {
      return { items: [], nextCursor: null, total: 0, kinds };
    }
    return { ...(await this.page(viewer, query, ids)), kinds };
  }

  /** The rows, cursor and total of one page (kind + optional subject ids). */
  private async page(
    viewer: HubMediaViewer,
    query: HubMediaListQuery,
    ids: number[] | null,
  ): Promise<Omit<HubMediaListResponse, 'kinds'>> {
    const kinds = kindsForFilter(query.kind);
    const cursor = query.cursor ? decodeHubMediaCursor(query.cursor) : null;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const q = { kinds, ids, cursor, limit };
    const rows = await listPage(this.db, viewer.scope, q);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.toItem(r, viewer)),
      nextCursor:
        rows.length > limit && last
          ? encodeHubMediaCursor({ capturedAt: last.capturedAt, id: last.id })
          : null,
      total: await countVisible(this.db, viewer.scope, kinds, ids),
    };
  }

  async item(
    actor: GuildActor,
    guildId: number,
    id: number,
  ): Promise<HubMediaItem> {
    const viewer = await this.viewer(actor, guildId);
    return this.toItem(await this.visibleRow(viewer, id), viewer);
  }

  /** Absolute path of a rendition the viewer may see (404 otherwise). */
  async filePath(
    actor: GuildActor,
    guildId: number,
    id: number,
    variant: HubMediaVariant,
  ): Promise<string> {
    const row = await this.visibleRow(await this.viewer(actor, guildId), id);
    return mediaFilePath(guildId, row.storageName, variant);
  }

  /**
   * D8 Hide / Unhide — editors only; reversible. ROK-1959 (Codex P2): the
   * picture must be visible to this editor first, so a gated source (spoiler
   * toggle, plugin off) answers 404 and is never modified or read back.
   */
  async setHidden(
    actor: GuildActor,
    guildId: number,
    id: number,
    hidden: boolean,
  ): Promise<HubMediaItem> {
    const viewer = await this.viewer(actor, guildId);
    if (!viewer.rights.canEdit) {
      throw new ForbiddenException('Guild editor access required');
    }
    await this.visibleRow(viewer, id);
    const row = await setHidden(this.db, guildId, id, hidden ? actor.id : null);
    if (!row) throw new NotFoundException(HUB_MEDIA_NOT_FOUND);
    return this.toItem(row, viewer);
  }

  /**
   * ROK-1965 D11 Remove — the hub leader (any picture) or the uploader (own,
   * while they can still see it); everyone else who can view → 403. A
   * tombstone (never re-ingested) + unlink both files.
   */
  async remove(actor: GuildActor, guildId: number, id: number): Promise<void> {
    const viewer = await this.viewer(actor, guildId);
    assertCanRemoveRow(viewer.rights, actor, await this.visibleRow(viewer, id));
    const storageName = await markRemoved(this.db, { guildId, id });
    if (!storageName) throw new NotFoundException(HUB_MEDIA_NOT_FOUND);
    await unlinkMediaFiles(guildId, storageName);
  }

  /**
   * The D7 404 gate, then the viewer's rights for this request. ROK-1959
   * D-5: gated sources are excluded for every viewer, editors included.
   */
  async viewer(actor: GuildActor, guildId: number): Promise<HubMediaViewer> {
    const rights = await assertCanViewHubMedia(
      this.db,
      this.access,
      actor,
      guildId,
    );
    const excludeSources = await this.gates.hiddenSources(guildId);
    const includeHidden = rights.canEdit;
    return { actor, rights, scope: { guildId, includeHidden, excludeSources } };
  }

  /** A row the viewer may see (editors include hidden rows), else 404. */
  async visibleRow(
    viewer: HubMediaViewer,
    id: number,
  ): Promise<schema.HubMediaRow> {
    const row = await findVisible(this.db, viewer.scope, id);
    if (!row) throw new NotFoundException(HUB_MEDIA_NOT_FOUND);
    return row;
  }

  toItem(row: schema.HubMediaRow, viewer: HubMediaViewer): HubMediaItem {
    const canRemove = canRemoveRow(viewer.rights, viewer.actor, row);
    return toHubMediaItem(row, this.decorators.linkFor(row), canRemove);
  }
}
