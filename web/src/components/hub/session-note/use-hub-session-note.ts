/**
 * ROK-1968 §6.2 — the note's read + write hooks, shared by the card (W1) and
 * the editor dialog (W2). Every write stores the server's response verbatim in
 * the cache, so `note.updatedAt` keeps its microseconds for the next
 * `baseUpdatedAt` (the server compares it as an exact string).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
    HubSessionNoteSchema,
    type HubSessionNote,
    type HubSessionNoteResponse,
    type PutHubSessionNoteInput,
} from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf, isConflictError } from '../../../lib/api/api-error';
import { toast } from '../../../lib/toast';
import { clearSessionNote, putSessionNote, tickSessionNoteItem } from './hub-session-note-api';
import { sessionNoteKey, sessionNoteQuery } from './hub-session-note-query';

export const ITEM_GONE_TOAST = 'That checklist item no longer exists';

export function useSessionNote(guildId: number) {
    return useQuery(sessionNoteQuery(guildId));
}

/** The note a 409 carried (`{ message, note }`), or undefined when the error is not a parseable conflict. */
export function conflictNoteOf(error: unknown): HubSessionNote | null | undefined {
    if (!isConflictError(error)) return undefined;
    const parsed = HubSessionNoteSchema.nullable().safeParse(errorBodyOf(error)?.['note']);
    return parsed.success ? parsed.data : undefined;
}

/** Editors: save. `conflict` is set after a 409 and carries the server's current note (null = it was cleared). */
export function useSaveSessionNote(guildId: number) {
    const client = useQueryClient();
    const mutation = useMutation({
        mutationFn: (input: PutHubSessionNoteInput) => putSessionNote(guildId, input),
        onSuccess: (data) => client.setQueryData(sessionNoteKey(guildId), data),
    });
    const conflictNote = conflictNoteOf(mutation.error);
    return { ...mutation, conflict: conflictNote === undefined ? null : { note: conflictNote } };
}

/** Editors: clear the note for everyone. */
export function useClearSessionNote(guildId: number) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => clearSessionNote(guildId),
        onSuccess: () => client.setQueryData<HubSessionNoteResponse>(sessionNoteKey(guildId),
            (prev) => (prev === undefined ? prev : { ...prev, note: null })),
    });
}

interface TickVars { itemId: number; done: boolean }

function withTick(prev: HubSessionNoteResponse | undefined, { itemId, done }: TickVars): HubSessionNoteResponse | undefined {
    if (prev?.note == null) return prev;
    const items = prev.note.items.map((item) => (item.id === itemId ? { ...item, done } : item));
    return { ...prev, note: { ...prev.note, items } };
}

async function applyOptimisticTick(client: QueryClient, guildId: number, vars: TickVars) {
    const key = sessionNoteKey(guildId);
    await client.cancelQueries({ queryKey: key });
    const previous = client.getQueryData<HubSessionNoteResponse>(key);
    client.setQueryData<HubSessionNoteResponse>(key, (prev) => withTick(prev, vars));
    return { previous };
}

/** Members + editors: optimistic tick; any error rolls back, a 404 (row or note gone) also refetches and toasts. */
export function useTickSessionNoteItem(guildId: number) {
    const client = useQueryClient();
    const mutationKey = [...sessionNoteKey(guildId), 'tick'];
    return useMutation({
        mutationKey,
        mutationFn: ({ itemId, done }: TickVars) => tickSessionNoteItem(guildId, itemId, done),
        onMutate: (vars) => applyOptimisticTick(client, guildId, vars),
        onError: (error, _vars, context) => {
            client.setQueryData(sessionNoteKey(guildId), context?.previous);
            if (httpStatusOf(error) !== 404) return;
            toast.error(ITEM_GONE_TOAST);
            void client.invalidateQueries({ queryKey: sessionNoteKey(guildId) });
        },
        onSuccess: (data) => {
            // A later tick still in flight owns the optimistic state; the last one to land stores the server copy.
            if (client.isMutating({ mutationKey }) <= 1) client.setQueryData(sessionNoteKey(guildId), data);
        },
    });
}
