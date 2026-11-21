/**
 * ROK-2272 S9 — the poll / lineup Discussion cache keys, outside the card so
 * the vote / suggest / nominate / withdraw mutations and hub-forum writes can
 * refresh it (the card's `can.read` / `can.reply` change with participation)
 * without importing component code. Mirrors `event-discussion-key.ts`.
 */
import type { QueryClient } from '@tanstack/react-query';

/** A non-event discussion subject: a scheduling poll (lineup match id) or a lineup. */
export type DiscussionSubject =
    | { kind: 'poll'; id: number }
    | { kind: 'lineup'; id: number };

const ROOT = 'subject-discussion';

/** Invalidation prefix for one subject's discussion summary (all viewers). */
export function subjectDiscussionKey(subject: DiscussionSubject): readonly unknown[] {
    return [ROOT, subject.kind, subject.id] as const;
}

/** Prefix-invalidate one subject's discussion card (all viewers). */
export function invalidateSubjectDiscussion(queryClient: QueryClient, subject: DiscussionSubject): void {
    void queryClient.invalidateQueries({ queryKey: subjectDiscussionKey(subject) });
}

/** Every cached poll / lineup discussion — a hub-forum write does not know its subject. */
export function invalidateAllSubjectDiscussions(queryClient: QueryClient): void {
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === ROOT });
}
