/**
 * ROK-1175 L2 — pure forum helpers: keyset cursors, the plain-text preview,
 * the `deleted_as` narrowing and the per-viewer permission matrix (`canFor`).
 * No DB, no Nest services.
 */
import {
  HUB_FORUM_EDIT_WINDOW_MS,
  HUB_FORUM_PREVIEW_MAX,
  markdownToPlainText,
  type HubForumCan,
  type HubForumDeleted,
} from '@raid-ledger/contract';
import { decodeCursor, encodeCursor } from '../posts/hub-posts.helpers';

/**
 * Keyset position. `at` is the DB's full-precision UTC ISO text of the sort
 * column (`last_activity_at` for threads, `created_at` for replies).
 */
export interface HubForumCursor {
  at: string;
  id: number;
}

/** Who is looking: `canWrite` = member (Q1), `canModerate` = officer/leader/staff. */
export interface HubForumActor {
  userId: number;
  canWrite: boolean;
  canModerate: boolean;
}

/** The row fields `canFor` needs (thread or reply). */
export interface HubForumOwnedRow {
  authorId: number | null;
  createdAt: Date;
  deletedAt: Date | null;
}

/** Opaque base64url cursor (same format and validation as hub posts). */
export function encodeForumCursor(pos: HubForumCursor): string {
  return encodeCursor({ createdAt: pos.at, id: pos.id });
}

/** Parse a cursor from `encodeForumCursor`; anything else is a 400. */
export function decodeForumCursor(cursor: string): HubForumCursor {
  const { createdAt, id } = decodeCursor(cursor);
  return { at: createdAt, id };
}

/**
 * One-line plain-text preview of a markdown body: whitespace collapsed, at
 * most `HUB_FORUM_PREVIEW_MAX` code points including a trailing ellipsis.
 */
export function forumPreview(body: string): string {
  const plain = markdownToPlainText(body).replace(/\s+/g, ' ').trim();
  const points = Array.from(plain);
  if (points.length <= HUB_FORUM_PREVIEW_MAX) return plain;
  const cut = points.slice(0, HUB_FORUM_PREVIEW_MAX - 1).join('').trimEnd();
  return `${cut}…`;
}

/** Narrow the `deleted_as` column to the contract enum (null = live). */
export function forumDeleted(deletedAs: string | null): HubForumDeleted {
  return deletedAs === 'author' || deletedAs === 'moderator' ? deletedAs : null;
}

/** True while `now` is inside the author's 24 h edit window (Q5). */
export function withinEditWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < HUB_FORUM_EDIT_WINDOW_MS;
}

/**
 * What `actor` may do to `row` (Q5/Q8): edit = live, own, member, inside the
 * window; delete = live and (own + member, or moderator); pin = live thread
 * (`pinnable`) and moderator. Moderators never edit another member's text.
 */
export function canFor(
  actor: HubForumActor,
  row: HubForumOwnedRow,
  opts: { now: Date; pinnable: boolean },
): HubForumCan {
  const live = row.deletedAt === null;
  const own = actor.canWrite && row.authorId === actor.userId;
  return {
    edit: live && own && withinEditWindow(row.createdAt, opts.now),
    delete: live && (own || actor.canModerate),
    pin: live && opts.pinnable && actor.canModerate,
  };
}
