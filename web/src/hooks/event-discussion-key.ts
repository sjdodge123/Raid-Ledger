/**
 * ROK-2226 — the event Discussion cache keys, outside the page so signup and
 * hub-forum mutations can refresh the card and `?discussion=1` panel without
 * importing page code (the card's `can`/replies change with a signup or reply).
 */
import type { QueryClient } from '@tanstack/react-query';

/** Invalidation prefix for one event's discussion summary + thread. */
export function eventDiscussionKey(eventId: number): readonly unknown[] {
    return ['events', eventId, 'discussion'] as const;
}

/** Prefix-invalidate one event's discussion card + panel (all viewers). */
export function invalidateEventDiscussion(queryClient: QueryClient, eventId: number): void {
    void queryClient.invalidateQueries({ queryKey: eventDiscussionKey(eventId) });
}

/** Every cached event discussion — a hub-forum write does not know its event id. */
export function invalidateAllEventDiscussions(queryClient: QueryClient): void {
    void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'events' && q.queryKey[2] === 'discussion',
    });
}
