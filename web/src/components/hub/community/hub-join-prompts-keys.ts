/**
 * ROK-1893 — the hub-join-prompt query key + post-signup watch, split out of
 * `hub-join-prompts-api.ts` so `useSignup` (eager, on the event page) can open
 * the watch without pulling the prompts API, its schemas and toasts into the
 * app entry chunk.
 */
import type { QueryClient } from '@tanstack/react-query';

/** Query key of the signed-in user's pending hub join prompts. */
export const HUB_JOIN_PROMPTS_KEY = ['hub-join-prompts'] as const;

/** How long after a signup the event page polls for its prompt (post-commit listener). */
export const PROMPT_WATCH_MS = 8_000;

export const promptWatchKey = (eventId: number) => ['hub-join-prompts-watch', eventId] as const;

/** Open the bounded post-signup watch for `eventId`'s prompt (called on signup success). */
export function watchHubJoinPrompts(qc: QueryClient, eventId: number): void {
    qc.setQueryData<number>(promptWatchKey(eventId), Date.now() + PROMPT_WATCH_MS);
}
