/** ROK-1175 — pure copy helpers for forum rows (and L5's thread view). */
import {
    HUB_FORUM_EDIT_WINDOW_MS, HUB_FORUM_TITLE_MAX, HubForumTitleInputSchema,
    type HubForumCan, type HubForumDeleted, type HubForumThreadSummary, type HubPostPerson,
} from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';

/** A deleted user's threads keep a null author (AC12). */
export function forumAuthorName(author: HubPostPerson | null): string {
    return author?.displayName ?? 'Former member';
}

/** The placeholder for removed text (AC6, Q8). */
export function forumDeletedLabel(deleted: Exclude<HubForumDeleted, null>): string {
    return deleted === 'author' ? 'Deleted by the author' : 'Removed by a moderator';
}

/** "1 reply" / "N replies". */
export function replyCountLabel(count: number): string {
    return count === 1 ? '1 reply' : `${count} replies`;
}

/** "Grimtusk · 2 h ago" — author and time since the thread's last activity. */
export function forumRowMeta(thread: HubForumThreadSummary, now: number = Date.now()): string {
    return `${forumAuthorName(thread.author)} · ${syncedAgo(thread.lastActivityAt, now)}`;
}

/** "2 h ago" for a message or row timestamp. */
export function forumAgo(iso: string, now: number = Date.now()): string {
    return syncedAgo(iso, now);
}

/** The title's inline error (the contract decides validity, the copy is ours); an empty title only disables submit. */
export function forumTitleError(title: string): string | null {
    if (title.trim() === '' || HubForumTitleInputSchema.safeParse(title).success) return null;
    return `Keep the title to ${HUB_FORUM_TITLE_MAX} characters`;
}

/** Who is looking at the Forum: their user id, and the hub's write / moderate rights. */
export interface ForumViewer { userId: number | null; canWrite: boolean; canModerate: boolean }

/**
 * A list row's "⋯" rights. Summaries carry no `can`, so this mirrors the api's
 * `canFor` (`hub-forum.helpers.ts`): edit = live + own + inside 24 h; delete =
 * live + (own or moderator); pin = live + moderator. The server still decides.
 */
export function forumRowCan(thread: HubForumThreadSummary, viewer: ForumViewer, now: number = Date.now()): HubForumCan {
    const live = thread.deleted === null;
    const own = viewer.canWrite && viewer.userId !== null && thread.author?.userId === viewer.userId;
    const fresh = now - Date.parse(thread.createdAt) < HUB_FORUM_EDIT_WINDOW_MS;
    return { edit: live && own && fresh, delete: live && (own || viewer.canModerate), pin: live && viewer.canModerate };
}
