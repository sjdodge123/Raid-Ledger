/**
 * ROK-1175 — the Forum tab's `?thread=<id>[&reply=<id>]#forum` deep-link
 * helpers. Their own tiny module (like `posts/post-link.ts`) so the hub shell
 * can read them without pulling the forum chunk into `hub-page`.
 */

function positiveIdParam(search: string, key: string): number | null {
    const raw = new URLSearchParams(search).get(key);
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return id > 0 ? id : null;
}

/** `?thread=<id>` from a location search string; null unless a positive integer. */
export function threadIdFromSearch(search: string): number | null {
    return positiveIdParam(search, 'thread');
}

/** `?reply=<id>` (a reply inside the open thread); null unless a positive integer. */
export function replyIdFromSearch(search: string): number | null {
    return positiveIdParam(search, 'reply');
}

/** In-page href for a thread (optionally one of its replies) on the Forum tab. */
export function forumThreadHref(threadId: number, replyId?: number): string {
    const reply = replyId === undefined ? '' : `&reply=${replyId}`;
    return `?thread=${threadId}${reply}#forum`;
}

/** `?edit=1`: open the thread with its opening message in the editor (the list row's Edit). */
export function editFromSearch(search: string): boolean {
    return new URLSearchParams(search).get('edit') === '1';
}

/** In-page href that opens a thread straight into editing its opening message. */
export function forumThreadEditHref(threadId: number): string {
    return `?thread=${threadId}&edit=1#forum`;
}
