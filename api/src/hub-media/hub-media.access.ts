import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type {
  GuildAccessService,
  GuildActor,
} from '../guilds/guild-access.service';
import {
  ladderCanEdit,
  ladderCanManageEditors,
} from '../guilds/guild-access.service';
import {
  HUB_NOT_FOUND,
  findHiddenAt,
  isHiddenFrom,
} from '../guilds/hub-hidden.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** What a viewer may do on a hub's Gallery, from ONE ladder lookup. */
export interface HubMediaRights {
  /** Leader or Officer — Hide / Unhide, and hidden rows are listed (D8). */
  canEdit: boolean;
  /** ROK-1965 D11: the hub leader (staff everywhere, a community Leader). */
  isLeader: boolean;
}

/**
 * ROK-1942 D7 — hub members + staff only, every kind: a missing hub, a hub
 * hidden from the viewer and a non-member all answer the same 404 (no
 * visitor read, even on an open community hub). Returns the viewer's rights
 * so the read path can include hidden rows for editors (D8) and compute each
 * item's `canRemove` (ROK-1965 D11/D12).
 */
export async function assertCanViewHubMedia(
  db: Db,
  access: GuildAccessService,
  actor: GuildActor,
  guildId: number,
): Promise<HubMediaRights> {
  if ((await findHiddenAt(db, guildId)) === undefined) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  if (await isHiddenFrom(db, actor, guildId)) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  if (!(await access.canView(actor, guildId))) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  const role = await access.resolveLadder(actor, guildId);
  return {
    canEdit: ladderCanEdit(role),
    isLeader: ladderCanManageEditors(role),
  };
}

/**
 * ROK-1965 D11 — Remove: the hub leader removes any picture; the uploader
 * removes their own. Officers / editors who are not leaders keep Hide only.
 */
export function canRemoveRow(
  rights: Pick<HubMediaRights, 'isLeader'>,
  actor: GuildActor,
  row: { uploadedBy: number | null },
): boolean {
  return (
    rights.isLeader || (row.uploadedBy !== null && row.uploadedBy === actor.id)
  );
}

export const HUB_MEDIA_REMOVE_FORBIDDEN =
  'Only the hub leader or the uploader can remove this picture';

/** D11 Remove, for a row the viewer can see: 403 unless leader or uploader. */
export function assertCanRemoveRow(
  rights: HubMediaRights,
  actor: GuildActor,
  row: { uploadedBy: number | null },
): void {
  if (!canRemoveRow(rights, actor, row)) {
    throw new ForbiddenException(HUB_MEDIA_REMOVE_FORBIDDEN);
  }
}
