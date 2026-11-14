/**
 * ROK-1175 L3 — who may do what in a hub forum. Read and write share one
 * check (Q1: members + staff; visitors 403 before any 404), and the pure
 * refusals below run `canFor` because the L2 writes never re-check the
 * edit window or authorship.
 */
import { ForbiddenException } from '@nestjs/common';
import type { GuildAccessService, GuildActor } from '../guild-access.service';
import {
  canFor,
  type HubForumActor,
  type HubForumOwnedRow,
} from './hub-forum.helpers';
import type { ForumRemoval } from './hub-forum.writes';

/** The 403 every non-member gets, on reads and writes alike. */
export const FORUM_NOT_MEMBER = 'Not a member of this guild';
/** Q5: the author's 24 h window has passed. */
export const FORUM_EDIT_WINDOW_CLOSED = 'Edit window closed';
/** Q5: moderators pin and remove, never rewrite. */
export const FORUM_NOT_AUTHOR = 'Only the author can edit this';
/** Q8: a removed message cannot be edited or removed again. */
export const FORUM_ALREADY_DELETED = 'This message was deleted';
/** Neither the author nor a moderator. */
export const FORUM_CANNOT_DELETE =
  'Only the author or a moderator can remove this';

/** Member (or staff) → forum actor; anyone else → 403. */
export async function resolveForumActor(
  access: GuildAccessService,
  actor: GuildActor,
  guildId: number,
): Promise<HubForumActor> {
  if (!(await access.canView(actor, guildId))) {
    throw new ForbiddenException(FORUM_NOT_MEMBER);
  }
  const canModerate = await access.canEdit(actor, guildId);
  return { userId: actor.id, canWrite: true, canModerate };
}

/** 403 unless `actor` may edit `row` now (author, live, inside 24 h). */
export function assertCanEdit(
  actor: HubForumActor,
  row: HubForumOwnedRow,
  now: Date,
): void {
  if (canFor(actor, row, { now, pinnable: false }).edit) return;
  if (row.deletedAt !== null)
    throw new ForbiddenException(FORUM_ALREADY_DELETED);
  if (row.authorId !== actor.userId)
    throw new ForbiddenException(FORUM_NOT_AUTHOR);
  throw new ForbiddenException(FORUM_EDIT_WINDOW_CLOSED);
}

/** The soft-delete stamp for `actor`, or 403 (Q8: author vs moderator). */
export function removalFor(
  actor: HubForumActor,
  row: HubForumOwnedRow,
  now: Date,
): ForumRemoval {
  if (!canFor(actor, row, { now, pinnable: false }).delete) {
    if (row.deletedAt !== null)
      throw new ForbiddenException(FORUM_ALREADY_DELETED);
    throw new ForbiddenException(FORUM_CANNOT_DELETE);
  }
  const as = row.authorId === actor.userId ? 'author' : 'moderator';
  return { by: actor.userId, as, now };
}
