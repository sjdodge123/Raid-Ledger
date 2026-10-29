/**
 * ROK-1968 — the "Before next session" note's light query layer: the per-hub
 * key and the `useQuery` options. Type-only contract imports and a dynamic
 * import of the fetcher keep it safe for the eagerly loaded probe and header
 * action (app-entry budget, Gallery precedent `lib/hub-media-query.ts`); the
 * card body and the editor dialog share the same key.
 */
import type { HubSessionNoteResponse } from '@raid-ledger/contract';

export const sessionNoteKey = (guildId: number) => ['hub', guildId, 'session-note'] as const;

/** `useQuery` options for one hub's note; idle until a guild id is known. A 404 (visitor) is not retried. */
export function sessionNoteQuery(guildId: number) {
    return {
        queryKey: sessionNoteKey(guildId),
        queryFn: async (): Promise<HubSessionNoteResponse> =>
            (await import('./hub-session-note-api')).fetchSessionNote(guildId),
        enabled: guildId > 0,
        retry: false,
        staleTime: 30_000,
    };
}
