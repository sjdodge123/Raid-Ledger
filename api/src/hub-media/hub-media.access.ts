import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type {
  GuildAccessService,
  GuildActor,
} from '../guilds/guild-access.service';
import { isStaff } from '../guilds/guild-access.service';
import {
  HUB_NOT_FOUND,
  findHiddenAt,
  isHiddenFrom,
} from '../guilds/hub-hidden.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1942 D7 — hub members + staff only, every kind: a missing hub, a hub
 * hidden from the viewer and a non-member all answer the same 404 (no
 * visitor read, even on an open community hub). Returns the viewer's edit
 * right so the read path can include hidden rows for editors (D8).
 */
export async function assertCanViewHubMedia(
  db: Db,
  access: GuildAccessService,
  actor: GuildActor,
  guildId: number,
): Promise<{ canEdit: boolean }> {
  if ((await findHiddenAt(db, guildId)) === undefined) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  if (await isHiddenFrom(db, actor, guildId)) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  if (!(await access.canView(actor, guildId))) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  return { canEdit: await access.canEdit(actor, guildId) };
}

/** D8 Hide / Unhide: viewers who are not editors get the GuildEditorGuard 403. */
export async function assertCanEditHubMedia(
  db: Db,
  access: GuildAccessService,
  actor: GuildActor,
  guildId: number,
): Promise<void> {
  const { canEdit } = await assertCanViewHubMedia(db, access, actor, guildId);
  if (!canEdit) throw new ForbiddenException('Guild editor access required');
}

/** D8 Remove: staff only (a viewer who is not staff gets 403). */
export async function assertCanRemoveHubMedia(
  db: Db,
  access: GuildAccessService,
  actor: GuildActor,
  guildId: number,
): Promise<void> {
  await assertCanViewHubMedia(db, access, actor, guildId);
  if (!isStaff(actor)) throw new ForbiddenException('Staff access required');
}
