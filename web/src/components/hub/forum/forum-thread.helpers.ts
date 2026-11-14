/** ROK-1175 — pure copy helpers for forum rows (and L5's thread view). */
import { HUB_FORUM_TITLE_MAX, HubForumTitleInputSchema, type HubForumDeleted, type HubForumThreadSummary, type HubPostPerson } from '@raid-ledger/contract';
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
